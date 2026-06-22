import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import { ReceiptOcrScanner } from "../components/ReceiptOcrScanner";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../services/shop.server";
import { formatEuros, moneyToCents } from "../services/money";
import { postExpense } from "../services/expenses.server";

type ScanResult = {
  date?: string;
  supplier?: string;
  description?: string;
  invoiceNumber?: string;
  net?: string;
  vat?: string;
  total?: string;
};

type OcrSpaceResponse = {
  ParsedResults?: Array<{ ParsedText?: string | null; ErrorMessage?: string | string[] | null; ErrorDetails?: string | null }>;
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string | string[] | null;
  ErrorDetails?: string | null;
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

function stringError(value: unknown) {
  if (Array.isArray(value)) return value.join(" ");
  return value ? String(value) : "";
}

async function readReceiptWithOcrSpace(file: File) {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) throw new Error("OCR_SPACE_API_KEY ontbreekt in Render environment variables");
  if (!file || file.size === 0) throw new Error("Upload eerst een bon of factuur");

  const body = new FormData();
  body.append("file", file, file.name || "receipt.jpg");
  body.append("language", "dut");
  body.append("isOverlayRequired", "false");
  body.append("isTable", "true");
  body.append("scale", "true");
  body.append("detectOrientation", "true");
  body.append("OCREngine", "2");

  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: { apikey: apiKey },
    body,
  });

  if (!response.ok) throw new Error(`OCR.space gaf status ${response.status}`);
  const data = (await response.json()) as OcrSpaceResponse;
  const apiError = stringError(data.ErrorMessage) || data.ErrorDetails || "";
  const pageError = stringError(data.ParsedResults?.[0]?.ErrorMessage) || data.ParsedResults?.[0]?.ErrorDetails || "";
  if (data.IsErroredOnProcessing || apiError || pageError) throw new Error(apiError || pageError || "OCR.space kon de bon niet uitlezen");

  const text = (data.ParsedResults || []).map((page) => page.ParsedText || "").join("\n").trim();
  if (!text) throw new Error("OCR.space vond geen tekst op deze bon");
  return text;
}

function parseReceiptText(text: string): ScanResult {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lower = text.toLowerCase();
  const result: ScanResult = {};

  const isoDate = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  const nlDate = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (isoDate) result.date = `${isoDate[1]}-${isoDate[2].padStart(2, "0")}-${isoDate[3].padStart(2, "0")}`;
  else if (nlDate) result.date = `${nlDate[3]}-${nlDate[2].padStart(2, "0")}-${nlDate[1].padStart(2, "0")}`;

  const invoiceMatch = text.match(/(?:factuur|invoice|bon|receipt|nr\.?|nummer)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-_/]{2,})/i);
  if (invoiceMatch) result.invoiceNumber = invoiceMatch[1];

  const amountPattern = /(-?\d{1,6}(?:[.,]\d{2}))/g;
  const amounts = Array.from(text.matchAll(amountPattern)).map((match) => moneyToCents(match[1].replace(",", ".")));
  const totalLine = lines.find((line) => /totaal|total|te betalen|amount due|paid|voldaan|pin/i.test(line));
  const vatLine = lines.find((line) => /btw|vat|tax/i.test(line));
  const netLine = lines.find((line) => /excl|netto|subtotal|subtotaal/i.test(line));

  const lastAmountInLine = (line?: string) => {
    if (!line) return undefined;
    const found = Array.from(line.matchAll(amountPattern));
    return found.length ? moneyToCents(found[found.length - 1][1].replace(",", ".")) : undefined;
  };

  const total = lastAmountInLine(totalLine) ?? amounts.reduce((max, amount) => amount > max ? amount : max, 0n);
  const vat = lastAmountInLine(vatLine) ?? (lower.includes("21%") ? calculateVatFromTotal(total, 21) : lower.includes("9%") ? calculateVatFromTotal(total, 9) : 0n);
  const net = lastAmountInLine(netLine) ?? (total > 0n ? total - vat : 0n);

  if (total > 0n) result.total = centsToInput(total);
  if (vat >= 0n) result.vat = centsToInput(vat);
  if (net >= 0n) result.net = centsToInput(net);
  result.supplier = lines.find((line) => !/factuur|invoice|bon|receipt|datum|date|btw|vat|tax|totaal|total|kvk|iban|tel|www|@/i.test(line)) || lines[0] || "";
  result.description = "Bon/factuur";

  return result;
}

function receiptParams(receipt: ScanResult, notice = "scan") {
  const params = new URLSearchParams({ scanned: "1", notice });
  for (const [key, value] of Object.entries(receipt)) if (value) params.set(key, value);
  return params;
}

function parseExpenseForm(form: FormData) {
  const date = new Date(`${String(form.get("date") || "")}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Ongeldige datum");

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

  return {
    date,
    supplier: String(form.get("supplier") || ""),
    description: String(form.get("description") || ""),
    invoiceNumber: String(form.get("invoiceNumber") || ""),
    netCents,
    vatCents,
    totalCents,
  };
}

async function deleteExpenseWithEntry(shopId: string, expenseId: string) {
  const expense = await prisma.expense.findFirst({ where: { id: expenseId, shopId } });
  if (!expense) throw new Error("Kostenpost niet gevonden");
  await prisma.$transaction([
    prisma.expense.delete({ where: { id: expense.id } }),
    prisma.journalEntry.delete({ where: { id: expense.journalEntryId } }),
  ]);
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
    notice: url.searchParams.get("notice") || "",
    saved: url.searchParams.get("saved") === "1",
    updated: url.searchParams.get("updated") === "1",
    deleted: url.searchParams.get("deleted") === "1",
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
      date: expense.date.toISOString().slice(0, 10),
      supplier: expense.supplier,
      description: expense.description,
      invoiceNumber: expense.invoiceNumber || "",
      net: centsToInput(expense.netCents),
      vat: centsToInput(expense.vatCents),
      total: centsToInput(expense.totalCents),
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

  try {
    if (intent === "ocr-space") {
      const file = form.get("receiptFile");
      if (!(file instanceof File)) throw new Error("Upload eerst een bon of factuur");
      const text = await readReceiptWithOcrSpace(file);
      const parsed = parseReceiptText(text);
      return redirect(`/app/expenses?${receiptParams(parsed, "ocr-space").toString()}`);
    }

    if (intent === "scan") {
      const parsed = parseReceiptText(String(form.get("receiptText") || ""));
      return redirect(`/app/expenses?${receiptParams(parsed).toString()}`);
    }

    if (intent === "delete") {
      await deleteExpenseWithEntry(shop.id, String(form.get("expenseId") || ""));
      return redirect("/app/expenses?deleted=1&notice=delete");
    }

    if (intent === "update") {
      const expenseId = String(form.get("expenseId") || "");
      const data = parseExpenseForm(form);
      await deleteExpenseWithEntry(shop.id, expenseId);
      await postExpense(shop.id, data);
      return redirect("/app/expenses?updated=1&notice=update");
    }

    await postExpense(shop.id, parseExpenseForm(form));
    return redirect("/app/expenses?saved=1&notice=save");
  } catch (error) {
    const message = encodeURIComponent(error instanceof Error ? error.message : String(error));
    return redirect(`/app/expenses?error=${message}&notice=${intent}`);
  }
};

type ExpenseFieldProps = { id: string; label: string; type?: "text" | "date" | "number"; defaultValue?: string; step?: string; required?: boolean; };

function ExpenseField({ id, label, type = "text", defaultValue, step, required = false }: ExpenseFieldProps) {
  return (
    <div style={{ display: "grid", gap: "0.35rem" }}>
      <label htmlFor={id} style={{ fontWeight: 600 }}>{label}</label>
      <input id={id} name={id} type={type} defaultValue={defaultValue} step={step} required={required} style={{ padding: "0.65rem", border: "1px solid #8c9196", borderRadius: "0.5rem", width: "100%", boxSizing: "border-box" }} />
    </div>
  );
}

function InlineNotice({ tone, children }: { tone: "success" | "warning" | "critical"; children: React.ReactNode }) {
  return <s-banner tone={tone}>{children}</s-banner>;
}

const buttonStyle = { minHeight: "2.25rem", padding: "0 0.9rem", border: "1px solid #303030", borderRadius: "0.5rem", background: "#303030", color: "white", fontWeight: 600, cursor: "pointer" };
const lightButtonStyle = { ...buttonStyle, background: "white", color: "#303030" };
const dangerButtonStyle = { ...buttonStyle, background: "#b42318", borderColor: "#b42318" };

export default function ExpensesPage() {
  const { expenses, defaults, saved, updated, deleted, scanned, error, notice } = useLoaderData<typeof loader>();

  useEffect(() => {
    const key = "expenses-scroll-y";
    const savedY = sessionStorage.getItem(key);
    if (savedY) {
      setTimeout(() => window.scrollTo(0, Number(savedY)), 0);
      setTimeout(() => window.scrollTo(0, Number(savedY)), 100);
      setTimeout(() => window.scrollTo(0, Number(savedY)), 350);
      sessionStorage.removeItem(key);
    }

    const saveScroll = () => sessionStorage.setItem(key, String(window.scrollY));
    document.addEventListener("submit", saveScroll, true);
    return () => document.removeEventListener("submit", saveScroll, true);
  }, []);

  return (
    <s-page heading="Kosten">
      <s-section heading="Bon/factuur scanner">
        <s-paragraph>Upload een bon/factuur via OCR.space of plak handmatig de tekst. Controleer daarna altijd de ingevulde velden.</s-paragraph>
        <ReceiptOcrScanner />

        <Form method="post" encType="multipart/form-data" preventScrollReset>
          <input type="hidden" name="intent" value="ocr-space" />
          <div style={{ display: "grid", gap: "0.75rem", maxWidth: "42rem", marginBottom: "1rem" }}>
            <input name="receiptFile" type="file" accept="image/*,.pdf" required style={{ padding: "0.65rem", border: "1px solid #8c9196", borderRadius: "0.5rem", width: "100%", boxSizing: "border-box" }} />
            <div><button type="submit" style={buttonStyle}>Bon uploaden en automatisch uitlezen</button></div>
            <s-paragraph>OCR.space gratis API heeft beperkte limieten. Gebruik bij voorkeur scherpe JPG/PNG-foto's en voeg in Render de variabele OCR_SPACE_API_KEY toe.</s-paragraph>
            {notice === "ocr-space" && error ? <InlineNotice tone="critical">OCR uitlezen mislukt: {error}</InlineNotice> : null}
            {notice === "ocr-space" && scanned ? <InlineNotice tone="warning">OCR is uitgelezen. Controleer de velden en klik daarna op Kosten boeken.</InlineNotice> : null}
          </div>
        </Form>

        <Form method="post" preventScrollReset>
          <input type="hidden" name="intent" value="scan" />
          <div style={{ display: "grid", gap: "0.75rem", maxWidth: "42rem" }}>
            <textarea name="receiptText" rows={8} placeholder="Of plak hier handmatig de tekst van je bon of factuur..." style={{ padding: "0.65rem", border: "1px solid #8c9196", borderRadius: "0.5rem", width: "100%", boxSizing: "border-box" }} />
            <div><button type="submit" style={lightButtonStyle}>Handmatige bontekst uitlezen</button></div>
            {notice === "scan" && error ? <InlineNotice tone="critical">Bontekst uitlezen mislukt: {error}</InlineNotice> : null}
            {notice === "scan" && scanned ? <InlineNotice tone="warning">Bontekst is uitgelezen. Controleer de velden en klik daarna op Kosten boeken.</InlineNotice> : null}
          </div>
        </Form>
      </s-section>

      <s-section heading="Kosten boeken">
        <Form method="post" preventScrollReset>
          <input type="hidden" name="intent" value="save" />
          <div style={{ display: "grid", gap: "0.75rem", maxWidth: "34rem" }}>
            <ExpenseField id="date" label="Datum" type="date" defaultValue={defaults.date} required />
            <ExpenseField id="supplier" label="Leverancier" defaultValue={defaults.supplier} required />
            <ExpenseField id="description" label="Omschrijving" defaultValue={defaults.description || "Zakelijke kosten"} required />
            <ExpenseField id="invoiceNumber" label="Factuurnummer / bonnummer (optioneel)" defaultValue={defaults.invoiceNumber} />
            <div style={{ display: "grid", gap: "0.35rem" }}>
              <label htmlFor="vatRate" style={{ fontWeight: 600 }}>Btw-percentage voor automatische berekening</label>
              <select id="vatRate" name="vatRate" defaultValue="21" style={{ padding: "0.65rem", border: "1px solid #8c9196", borderRadius: "0.5rem", background: "white" }}>
                <option value="21">21%</option><option value="9">9%</option><option value="0">0% / geen btw</option>
              </select>
            </div>
            <ExpenseField id="net" label="Bedrag exclusief btw" type="number" step="0.01" defaultValue={defaults.net} />
            <ExpenseField id="vat" label="Btw" type="number" step="0.01" defaultValue={defaults.vat} />
            <ExpenseField id="total" label="Totaal betaald" type="number" step="0.01" defaultValue={defaults.total} required />
            <s-paragraph>Laat exclusief btw en btw leeg als je alleen het totaal weet. De app rekent dan automatisch terug op basis van het gekozen btw-percentage.</s-paragraph>
            <div><button type="submit" style={buttonStyle}>Kosten boeken</button></div>
            {notice === "save" && error ? <InlineNotice tone="critical">Kosten boeken mislukt: {error}</InlineNotice> : null}
            {notice === "save" && saved ? <InlineNotice tone="success">Kosten zijn geboekt.</InlineNotice> : null}
          </div>
        </Form>
      </s-section>

      <s-section heading="Recente kosten">
        {expenses.length === 0 ? <s-paragraph>Nog geen kosten geboekt.</s-paragraph> : (
          <div style={{ display: "grid", gap: "1rem" }}>
            {expenses.map((expense) => (
              <details key={expense.id} style={{ border: "1px solid #e1e3e5", borderRadius: "1rem", padding: "1rem", background: "white" }}>
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>{expense.date} · {expense.supplier} · {formatEuros(BigInt(expense.totalCents))} · boeking #{expense.entryNumber}</summary>
                <Form method="post" preventScrollReset>
                  <input type="hidden" name="intent" value="update" />
                  <input type="hidden" name="expenseId" value={expense.id} />
                  <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem", maxWidth: "34rem" }}>
                    <ExpenseField id="date" label="Datum" type="date" defaultValue={expense.date} required />
                    <ExpenseField id="supplier" label="Leverancier" defaultValue={expense.supplier} required />
                    <ExpenseField id="description" label="Omschrijving" defaultValue={expense.description} required />
                    <ExpenseField id="invoiceNumber" label="Factuurnummer / bonnummer" defaultValue={expense.invoiceNumber} />
                    <ExpenseField id="net" label="Bedrag exclusief btw" type="number" step="0.01" defaultValue={expense.net} />
                    <ExpenseField id="vat" label="Btw" type="number" step="0.01" defaultValue={expense.vat} />
                    <ExpenseField id="total" label="Totaal betaald" type="number" step="0.01" defaultValue={expense.total} required />
                    <input type="hidden" name="vatRate" value="21" />
                    <div><button type="submit" style={lightButtonStyle}>Wijzig opslaan</button></div>
                    {notice === "update" && error ? <InlineNotice tone="critical">Wijzigen mislukt: {error}</InlineNotice> : null}
                    {notice === "update" && updated ? <InlineNotice tone="success">Kostenpost is gewijzigd.</InlineNotice> : null}
                  </div>
                </Form>
                <Form method="post" preventScrollReset>
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="expenseId" value={expense.id} />
                  <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem", maxWidth: "34rem" }}>
                    <button type="submit" style={dangerButtonStyle}>Verwijderen</button>
                    {notice === "delete" && error ? <InlineNotice tone="critical">Verwijderen mislukt: {error}</InlineNotice> : null}
                    {notice === "delete" && deleted ? <InlineNotice tone="success">Kostenpost is verwijderd.</InlineNotice> : null}
                  </div>
                </Form>
              </details>
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}
