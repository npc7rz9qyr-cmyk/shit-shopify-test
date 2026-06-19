import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

type ReceiptData = {
  supplier: string;
  date: string;
  invoiceNumber: string;
  description: string;
  net: string;
  vat: string;
  total: string;
  vatRate: string;
  rawText: string;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyReceipt(rawText = ""): ReceiptData {
  return {
    supplier: "",
    date: "",
    invoiceNumber: "",
    description: "Bon/factuur",
    net: "",
    vat: "",
    total: "",
    vatRate: "21",
    rawText,
  };
}

function extractJson(text: string) {
  const direct = text.trim();
  try {
    return JSON.parse(direct);
  } catch {
    const match = direct.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function cleanMoney(value: unknown) {
  if (value === null || value === undefined) return "";
  const raw = String(value).replace(/[^0-9,.-]/g, "").replace(",", ".");
  if (!raw || raw === "." || raw === "-") return "";
  const number = Number(raw);
  if (!Number.isFinite(number)) return "";
  return number.toFixed(2);
}

function cleanDate(value: unknown) {
  if (!value) return "";
  const raw = String(value).trim();
  const iso = raw.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (iso) return raw;
  const nl = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})$/);
  if (nl) return `${nl[3]}-${nl[2].padStart(2, "0")}-${nl[1].padStart(2, "0")}`;
  return "";
}

function normalizeReceipt(parsed: Record<string, unknown> | null, rawText = ""): ReceiptData {
  if (!parsed) return emptyReceipt(rawText);
  return {
    supplier: String(parsed.supplier || parsed.leverancier || "").trim(),
    date: cleanDate(parsed.date || parsed.datum),
    invoiceNumber: String(parsed.invoiceNumber || parsed.invoice_number || parsed.factuurnummer || parsed.bonnummer || "").trim(),
    description: String(parsed.description || parsed.omschrijving || "Bon/factuur").trim() || "Bon/factuur",
    net: cleanMoney(parsed.net || parsed.excl_btw || parsed.excluding_vat),
    vat: cleanMoney(parsed.vat || parsed.btw || parsed.tax),
    total: cleanMoney(parsed.total || parsed.totaal || parsed.incl_btw || parsed.amount_paid),
    vatRate: String(parsed.vatRate || parsed.vat_rate || parsed.btw_percentage || "21").replace(/[^0-9]/g, "") || "21",
    rawText: String(parsed.rawText || parsed.raw_text || rawText || ""),
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json({ error: "OPENAI_API_KEY ontbreekt in Render Environment Variables." }, 500);
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return json({ error: "Geen bonbestand ontvangen." }, 400);
  }

  if (file.size > 8 * 1024 * 1024) {
    return json({ error: "Bestand is te groot. Upload maximaal 8 MB." }, 400);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "image/jpeg";
  const imageUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;

  const prompt = `Lees deze Nederlandse bon of factuur nauwkeurig uit. Geef alleen geldige JSON terug, zonder markdown.

Velden:
{
  "supplier": "leverancier/winkelnaam",
  "date": "YYYY-MM-DD",
  "invoiceNumber": "factuur- of bonnummer",
  "description": "korte omschrijving",
  "net": "bedrag exclusief btw met punt als decimaal",
  "vat": "btw-bedrag met punt als decimaal",
  "total": "totaal betaald met punt als decimaal",
  "vatRate": "0, 9 of 21",
  "rawText": "belangrijkste gelezen tekst"
}

Regels:
- Laat onbekende velden leeg.
- Gebruik Nederlandse datum als YYYY-MM-DD.
- Neem het totaalbedrag niet over uit willekeurige productregels als er een duidelijke totaalregel staat.
- Corrigeer OCR-fouten in bedragen zoals O/0 en I/1.
- Gebruik alleen bedragen die zichtbaar op de bon staan of logisch volgen uit totaal en btw.`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || "gpt-5.5",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageUrl, detail: "high" },
          ],
        },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    return json({ error: data?.error?.message || "AI OCR mislukt." }, response.status);
  }

  const outputText =
    typeof data.output_text === "string"
      ? data.output_text
      : Array.isArray(data.output)
        ? data.output.flatMap((item: any) => item.content || []).map((part: any) => part.text || "").join("\n")
        : "";

  const parsed = extractJson(outputText);
  return json({ receipt: normalizeReceipt(parsed, outputText) });
};
