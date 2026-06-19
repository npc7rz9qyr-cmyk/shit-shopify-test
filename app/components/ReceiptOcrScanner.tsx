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

function normalizeOcrText(text: string) {
  return text
    .replace(/[€]/g, " ")
    .replace(/\bO(?=\d)/g, "0")
    .replace(/(?<=\d)O\b/g, "0")
    .replace(/(?<=\d)[oO](?=\d)/g, "0")
    .replace(/(?<=\d)[lI](?=\d)/g, "1")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMoney(value: string) {
  return moneyToCents(value.replace(/\s/g, "").replace(",", "."));
}

function parseReceiptText(text: string): ScanResult {
  const cleaned = normalizeOcrText(text);
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeOcrText(line))
    .filter(Boolean);
  const lower = cleaned.toLowerCase();
  const result: ScanResult = {};

  const isoDate = cleaned.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  const nlDate = cleaned.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (isoDate) {
    result.date = `${isoDate[1]}-${isoDate[2].padStart(2, "0")}-${isoDate[3].padStart(2, "0")}`;
  } else if (nlDate) {
    result.date = `${nlDate[3]}-${nlDate[2].padStart(2, "0")}-${nlDate[1].padStart(2, "0")}`;
  }

  const invoiceMatch = cleaned.match(/(?:factuur|invoice|bon|receipt|nr\.?|nummer)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-_/]{2,})/i);
  if (invoiceMatch) result.invoiceNumber = invoiceMatch[1];

  const amountPattern = /(-?\d{1,6}(?:[.,]\d{2}))/g;
  const amounts = Array.from(cleaned.matchAll(amountPattern))
    .map((match) => parseMoney(match[1]))
    .filter((amount) => amount >= 0n);

  const findLine = (patterns: RegExp[]) =>
    lines.find((line) => patterns.some((pattern) => pattern.test(line)));

  const totalLine = findLine([/totaal/i, /total/i, /te betalen/i, /amount due/i, /voldaan/i, /pin/i]);
  const vatLine = findLine([/btw/i, /vat/i, /tax/i]);
  const netLine = findLine([/excl/i, /exclusief/i, /netto/i, /subtotal/i, /subtotaal/i]);

  const lastAmountInLine = (line?: string) => {
    if (!line) return undefined;
    const found = Array.from(line.matchAll(amountPattern));
    return found.length ? parseMoney(found[found.length - 1][1]) : undefined;
  };

  const largestAmount = amounts.reduce((max, amount) => amount > max ? amount : max, 0n);
  const total = lastAmountInLine(totalLine) ?? largestAmount;
  const vat = lastAmountInLine(vatLine) ?? (lower.includes("21%") ? calculateVatFromTotal(total, 21) : lower.includes("9%") ? calculateVatFromTotal(total, 9) : 0n);
  const net = lastAmountInLine(netLine) ?? (total > 0n ? total - vat : 0n);

  if (total > 0n) result.total = centsToInput(total);
  if (vat >= 0n) result.vat = centsToInput(vat);
  if (net >= 0n) result.net = centsToInput(net);

  result.supplier = lines.find((line) => !/factuur|invoice|bon|receipt|datum|date|btw|vat|tax|totaal|total|kvk|iban|tel|www|@|pin|voldaan/i.test(line)) || lines[0] || "";
  result.description = "Bon/factuur";

  return result;
}

async function preprocessReceiptImage(file: File) {
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Afbeelding kon niet worden geladen"));
      image.src = objectUrl;
    });

    const targetWidth = Math.min(Math.max(image.width, 1400), 2200);
    const scale = targetWidth / image.width;
    const targetHeight = Math.round(image.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return file;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

    const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const pixels = imageData.data;

    for (let index = 0; index < pixels.length; index += 4) {
      const gray = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
      const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.55 + 128));
      const sharpened = contrasted > 170 ? 255 : contrasted < 105 ? 0 : contrasted;
      pixels[index] = sharpened;
      pixels[index + 1] = sharpened;
      pixels[index + 2] = sharpened;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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
    setStatus("Foto wordt verbeterd voor OCR...");
    setPreviewUrl(URL.createObjectURL(file));

    try {
      const processedImage = await preprocessReceiptImage(file);
      setStatus("Bon wordt gelezen... dit kan even duren.");
      const Tesseract = await import("tesseract.js");
      const result = await Tesseract.recognize(processedImage, "nld+eng", {
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
