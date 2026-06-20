import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import { ReceiptOcrScanner } from "../components/ReceiptOcrScanner";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../services/shop.server";
import { formatEuros, moneyToCents } from "../services/money";
import { postExpense } from "../services/expenses.server";
import { readReceiptFromImageFile } from "../services/receipt-ocr.server";

type ScanResult = {
  date?: string;
  supplier?: string;
  description?: string;
  invoiceNumber?: string;
  net?: string;
  vat?: string;
  total?: string;
};

function centsToInput(value: bigint) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const euros = absolute / 100n;
  const cents = String(absolute % 100n).padStart(2, "0");
  return `${negative ? "-" : ""}${euros}.${cents}`;
}

function calculateVatFromTotal(totalCents: bigint, vatRate: number) {
  if (vatRate <= 0) return 0n;
  return (totalCents * BigInt(vatRate)) / BigInt(100 + vatRate);
}

function parseAmount(value: FormDataEntryValue | null) {
  return moneyToCents(String(value || "0").replace(",", "."));
}

function parseReceiptText(text: string): ScanResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lower = text.toLowerCase();
  const result: ScanResult = {};

  const isoDate = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  const nlDate = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (isoDate) {
    result.date = `${isoDate[1]}-${isoDate[2].padStart(2, "0")}-${isoDate[3].padStart(2, "0")}`;
  } else if (nlDate) {
    result.date = `${nlDate[3]}-${nlDate[2].padStart(2, "0")}-${nlDate[1].padStart(2, "0")}`;
  }

  const invoiceMatch = text.match(/(?:factuur|invoice|bon|receipt|nr\.?|nummer)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-_/]{2,})/i);
  if (invoiceMatch) result.invoiceNumber = invoiceMatch[1];

  const amountPattern = /(-?\d{1,6}(?:[.,]\d{2}))/g;
  const amounts = Array.from(text.matchAll(amountPattern)).map((match) => ({
    raw: match[1],
    cents: moneyToCents(match[1].replace(",", ".")),
    index: match.index || 0,
  }));

  const totalLine = lines.find((line) => /totaal|total|te betalen|amount due|paid/i.test(line));
  const vatLine = lines.find((line) => /btw|vat|tax/i.test(line));
  const netLine = lines.find((line) => /excl|netto|subtotal|subtotaal/i.test(line));

  const lastAmountInLine = (line?: string) => {
    if (!line) return undefined;
    const found = Array.from(line.matchAll(amountPattern));
    return found.length ? moneyToCents(found[found.length - 1][1].replace(",", ".")) : undefined;
  };

  const total = lastAmountInLine(totalLine) ?? amounts.reduce((max, amount) => amount.cents > max ? amount.cents : max, 0n);
  const vat = lastAmountInLine(vatLine) ?? (lower.includes("21%") ? calculateVatFromTotal(total, 21) : lower.includes("9%") ? calculateVatFromTotal(total, 9) : 0n);
  const net = lastAmountInLine(netLine) ?? (total > 0n ? total - vat : 0n);

  if (total > 0n) result.total = centsToInput(total);
  if (vat >= 0n) result.vat = centsToInput(vat);
  if (net >= 0n) result.net = centsToInput(net);

  result.supplier = lines.find((line) => !/factuur|invoice|bon|receipt|datum|date|btw|vat|tax|totaal|total/i.test(line)) || lines[0] || "";
  result.description = "Bon/factuur";

  return result;
}

function receiptParams(receipt: {
  date?: string;
  supplier?: string;
  description?: string;
  invoiceNumber?: string;
  net?: string;
  vat?: string;
  total?: string;
  vatRate?: string;
}) {
  const params = new URLSearchParams({ scanned: "1" });
  for (const [key, value] of Object.entries(receipt)) {
    if (value) params.set(key, value);
  }
  return params;
}

function pickReceiptFile(form: FormData) {
  const candidates = [form.get("receiptFileCamera"), form.get("receiptFileUpload"), form.get("receiptFile")];
  return candidates.find((candidate): candidate is File => candidate instanceof File && candidate.size > 0);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const url = new URL(request.url);
  const expenses = await prisma.expense.findMany({
    where: { shopId: shop.id },
    orderBy: { date: "desc" },
    take: 100,
    include: { journalEntry: true },
  });

  return {
    saved: url.searchParams.get("saved") === "1",
    scanned: url.searchParams.get("scanned") === "1",
    error: url.searchParams.get("error"),
    defaults: {
      date: url.searchParams.get("date") || new Date().toISOString().slice(0, 10),
      supplier: url.searchParams.get("supplier") || "",
      description: url.searchParams.get("description") || "",
      invoiceNumber: url.searchParams.get("invoiceNumber") || "",
      net: url.searchParams.get("net") || "",
      vat: url.searchParams.get("vat") || "",
      total: url.searchParams.get("total") || "",
    },
    expenses: expenses.map((expense) => ({
      id: expense.id,
      date: expense.date.toISOString(),
      supplier: expense.supplier,
      description: expense.description,
      invoiceNumber: expense.invoiceNumber,
      netCents: expense.netCents.toString(),
      totalCents: expense.totalCents.toString(),
      vatCents: expense.vatCents.toString(),
      entryNumber: expense.journalEntry.entryNumber,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const form = await request.formData();
  const intent = String(form.get("intent") || "save");

  if (intent === "ai-scan") {
    try {
      const file = pickReceiptFile(form);
      if (!file) throw new Error("Geen bonfoto ontvangen.");
      const receipt = await readReceiptFromImageFile(file);
      return redirect(`/app/expenses?${receiptParams(receipt).toString()}`);
    } catch (error) {
      const message = encodeURIComponent(error instanceof Error ? error.message : String(error));
      return redirect(`/app/expenses?error=${message}`);
    }
  }

  if (intent === "scan") {
    const text = String(form.get("receiptText") || "");
    const parsed = parseReceiptText(text);
    return redirect(`/app/expenses?${receiptParams(parsed).toString()}`);
  }

  const date = new Date(`${String(form.get("date") || "")}T12:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return redirect(`/app/expenses?error=${encodeURIComponent("Ongeldige datum")}`);
  }

  try {
    const totalCents = parseAmount(form.get("total"));
    const vatRate = Number(form.get("vatRate") || "21");
    let vatCents = parseAmount(form.get("vat"));
    let netCents = parseAmount(form.get("net"));

    if (totalCents <= 0n) throw new Error("Totaal betaald is verplicht");

    if (netCents === 0n && vatCents === 0n) {
      vatCents = calculateVatFromTotal(totalCents, vatRate);
      netCents = totalCents - vatCents;
    } else if (netCents === 0n) {
      netCents = totalCents - vatCents;
    } else if (vatCents === 0n) {
      vatCents = totalCents - netCents;
    }

    await postExpense(shop.id, {
      date,
      supplier: String(form.get("supplier") || ""),
      description: String(form.get("description") || ""),
      invoiceNumber: String(form.get("invoiceNumber") || ""),
      netCents,
      vatCents,
      totalCents,
    });
  } catch (error) {
    const message = encodeURIComponent(error instanceof Error ? error.message : String(error));
    return redirect(`/app/expenses?error=${message}`);
  }

  return redirect("/app/expenses?saved=1");
};

type ExpenseFieldProps = {
  id: string;
  label: string;
  type?: "text" | "date" | "number";
  defaultValue?: string;
  step?: string;
  required?: boolean;
};

function ExpenseField({ id, label, type = "text", defaultValue, step, required = false }: ExpenseFieldProps) {
  return (
    <div style={{ display: "grid", gap: "0.35rem" }}>
      <label htmlFor={id} style={{ fontWeight: 600 }}>{label}</label>
      <input id={id} name={id} type={type} defaultValue={defaultValue} step={step} required={required} style={{ padding: "0.65rem", border: "1px solid #8c9196", borderRadius: "0.5rem", width: "100%", boxSizing: "border-box" }} />
    </div>
  );
}

const buttonStyle = { minHeight: "2.25rem", padding: "0 0.9rem", border: "1px solid #303030", borderRadius: "0.5rem", background: "#303030", color: "white", fontWeight: 600, cursor: "pointer" };

export default function ExpensesPage() {
  const { expenses, defaults, saved, scanned, error } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Kosten">
      {error ? <s-section><s-banner tone="critical">Kosten boeken mislukt: {error}</s-banner></s-section> : null}
      {saved ? <s-section><s-banner tone="success">Kosten zijn geboekt.</s-banner></s-section> : null}
      {scanned ? <s-section><s-banner tone="warning">Bon is uitgelezen. Controleer de velden en klik daarna op Kosten boeken.</s-banner></s-section> : null}

      <s-section heading="Bon/factuur scanner">
        <s-paragraph>Maak direct een foto of upload een bon. De app leest de bon met AI en vult leverancier, datum, totaal, btw en omschrijving alvast in.</s-paragraph>
        <ReceiptOcrScanner />
        <Form method="post">
          <input type="hidden" name="intent" value="scan" />
          <div style={{ display: "grid", gap: "0.75rem", maxWidth: "42rem" }}>
            <textarea name="receiptText" rows={8} placeholder="Of plak hier handmatig de tekst van je bon of factuur..." style={{ padding: "0.65rem", border: "1px solid #8c9196", borderRadius: "0.5rem", width: "100%", boxSizing: "border-box" }} />
            <div><button type="submit" style={buttonStyle}>Bontekst uitlezen</button></div>
          </div>
        </Form>
      </s-section>

      <s-section heading="Kosten boeken">
        <Form method="post">
          <input type="hidden" name="intent" value="save" />
          <div style={{ display: "grid", gap: "0.75rem", maxWidth: "34rem" }}>
            <ExpenseField id="date" label="Datum" type="date" defaultValue={defaults.date} required />
            <ExpenseField id="supplier" label="Leverancier" defaultValue={defaults.supplier} required />
            <ExpenseField id="description" label="Omschrijving" defaultValue={defaults.description || "Zakelijke kosten"} required />
            <ExpenseField id="invoiceNumber" label="Factuurnummer / bonnummer (optioneel)" defaultValue={defaults.invoiceNumber} />
            <div style={{ display: "grid", gap: "0.35rem" }}>
              <label htmlFor="vatRate" style={{ fontWeight: 600 }}>Btw-percentage voor automatische berekening</label>
              <select id="vatRate" name="vatRate" defaultValue="21" style={{ padding: "0.65rem", border: "1px solid #8c9196", borderRadius: "0.5rem", background: "white" }}>
                <option value="21">21%</option>
                <option value="9">9%</option>
                <option value="0">0% / geen btw</option>
              </select>
            </div>
            <ExpenseField id="net" label="Bedrag exclusief btw" type="number" step="0.01" defaultValue={defaults.net} />
            <ExpenseField id="vat" label="Btw" type="number" step="0.01" defaultValue={defaults.vat} />
            <ExpenseField id="total" label="Totaal betaald" type="number" step="0.01" defaultValue={defaults.total} required />
            <s-paragraph>Laat exclusief btw en btw leeg als je alleen het totaal weet. De app rekent dan automatisch terug op basis van het gekozen btw-percentage.</s-paragraph>
            <div><button type="submit" style={buttonStyle}>Kosten boeken</button></div>
          </div>
        </Form>
      </s-section>

      <s-section heading="Recente kosten">
        {expenses.length === 0 ? (
          <s-paragraph>Nog geen kosten geboekt.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Datum</s-table-header>
              <s-table-header>Leverancier</s-table-header>
              <s-table-header>Omschrijving</s-table-header>
              <s-table-header>Excl.</s-table-header>
              <s-table-header>Btw</s-table-header>
              <s-table-header>Totaal</s-table-header>
              <s-table-header>Boeking</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {expenses.map((expense) => (
                <s-table-row key={expense.id}>
                  <s-table-cell>{new Date(expense.date).toLocaleDateString("nl-NL")}</s-table-cell>
                  <s-table-cell>{expense.supplier}</s-table-cell>
                  <s-table-cell>{expense.description}</s-table-cell>
                  <s-table-cell>{formatEuros(BigInt(expense.netCents))}</s-table-cell>
                  <s-table-cell>{formatEuros(BigInt(expense.vatCents))}</s-table-cell>
                  <s-table-cell>{formatEuros(BigInt(expense.totalCents))}</s-table-cell>
                  <s-table-cell>#{expense.entryNumber}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}
