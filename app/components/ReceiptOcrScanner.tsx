import { useRef, useState } from "react";
import { moneyToCents } from "../services/money";

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
    cents: moneyToCents(match[1].replace(",", ".")),
  }));

  const totalLine = lines.find((line) => /totaal|total|te betalen|amount due|paid|pin|voldaan/i.test(line));
  const vatLine = lines.find((line) => /btw|vat|tax/i.test(line));
  const netLine = lines.find((line) => /excl|exclusief|netto|subtotal|subtotaal/i.test(line));

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

  result.supplier = lines.find((line) => !/factuur|invoice|bon|receipt|datum|date|btw|vat|tax|totaal|total|kvk|iban|tel|www|@/i.test(line)) || lines[0] || "";
  result.description = "Bon/factuur";

  return result;
}

function setFormValue(name: string, value?: string) {
  if (!value) return;
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
  if (!element) return;
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function applyResult(text: string) {
  const parsed = parseReceiptText(text);
  setFormValue("receiptText", text);
  setFormValue("date", parsed.date);
  setFormValue("supplier", parsed.supplier);
  setFormValue("description", parsed.description);
  setFormValue("invoiceNumber", parsed.invoiceNumber);
  setFormValue("net", parsed.net);
  setFormValue("vat", parsed.vat);
  setFormValue("total", parsed.total);
}

const primaryButton = {
  minHeight: "2.25rem",
  padding: "0 0.9rem",
  border: "1px solid #303030",
  borderRadius: "0.5rem",
  background: "#303030",
  color: "white",
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButton = {
  ...primaryButton,
  background: "white",
  color: "#303030",
};

export function ReceiptOcrScanner() {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");

  async function handleFile(file?: File) {
    if (!file) return;
    setStatus("Bon wordt gelezen... dit kan even duren.");
    setPreviewUrl(URL.createObjectURL(file));

    try {
      const Tesseract = await import("tesseract.js");
      const result = await Tesseract.recognize(file, "nld+eng", {
        logger: (message: { status?: string; progress?: number }) => {
          if (!message.status) return;
          const progress = message.progress ? ` ${Math.round(message.progress * 100)}%` : "";
          setStatus(`${message.status}${progress}`);
        },
      });
      applyResult(result.data.text || "");
      setStatus("Bon is uitgelezen. Controleer de velden en klik op Kosten boeken.");
    } catch (error) {
      setStatus(`OCR mislukt: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.75rem", marginBottom: "1rem" }}>
      <input ref={uploadInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(event) => handleFile(event.currentTarget.files?.[0])} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(event) => handleFile(event.currentTarget.files?.[0])} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
        <button type="button" style={primaryButton} onClick={() => cameraInputRef.current?.click()}>Foto maken</button>
        <button type="button" style={secondaryButton} onClick={() => uploadInputRef.current?.click()}>Bon uploaden</button>
      </div>

      {status ? <s-banner tone="warning">{status}</s-banner> : null}
      {previewUrl ? <img src={previewUrl} alt="Bon preview" style={{ maxWidth: "100%", maxHeight: "360px", borderRadius: "1rem", border: "1px solid #e1e3e5" }} /> : null}
    </div>
  );
}
