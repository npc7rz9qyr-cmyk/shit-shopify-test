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

type Crop = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type ImageMode = "soft" | "balanced" | "hard";

const DEFAULT_CROP: Crop = { top: 5, right: 5, bottom: 5, left: 5 };

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
    .filter((amount) => amount >= 0n && amount < 10000000n);

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

function receiptScore(text: string) {
  const normalized = normalizeOcrText(text).toLowerCase();
  const amounts = normalized.match(/\d{1,6}[.,]\d{2}/g)?.length || 0;
  const keywords = ["totaal", "total", "btw", "vat", "tax", "factuur", "bon", "receipt", "datum", "pin", "voldaan"].filter((word) => normalized.includes(word)).length;
  const letters = normalized.match(/[a-z]/g)?.length || 0;
  const digits = normalized.match(/\d/g)?.length || 0;
  const garbage = normalized.match(/[{}[\]<>|~^]/g)?.length || 0;
  const lengthScore = normalized.length > 30 && normalized.length < 2500 ? 2 : 0;
  return amounts * 3 + keywords * 2 + Math.min(4, Math.floor((letters + digits) / 80)) + lengthScore - garbage;
}

async function imageToCanvasSource(file: File) {
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Afbeelding kon niet worden geladen"));
      image.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function preprocessReceiptImage(file: File, crop: Crop, mode: ImageMode) {
  const image = await imageToCanvasSource(file);
  const safeLeft = Math.min(crop.left, 45);
  const safeRight = Math.min(crop.right, 45);
  const safeTop = Math.min(crop.top, 45);
  const safeBottom = Math.min(crop.bottom, 45);
  const cropX = Math.round(image.width * safeLeft / 100);
  const cropY = Math.round(image.height * safeTop / 100);
  const cropW = Math.max(120, Math.round(image.width * (100 - safeLeft - safeRight) / 100));
  const cropH = Math.max(120, Math.round(image.height * (100 - safeTop - safeBottom) / 100));
  const targetWidth = Math.min(Math.max(cropW, 1600), 2600);
  const scale = targetWidth / cropW;
  const targetHeight = Math.round(cropH * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return file;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, cropX, cropY, cropW, cropH, 0, 0, targetWidth, targetHeight);

  const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const pixels = imageData.data;
  const contrast = mode === "soft" ? 1.18 : mode === "balanced" ? 1.45 : 1.75;
  const dark = mode === "soft" ? 70 : mode === "balanced" ? 95 : 120;
  const light = mode === "soft" ? 220 : mode === "balanced" ? 178 : 160;

  for (let index = 0; index < pixels.length; index += 4) {
    const gray = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
    const contrasted = Math.max(0, Math.min(255, (gray - 128) * contrast + 128));
    const output = contrasted > light ? 255 : contrasted < dark ? 0 : contrasted;
    pixels[index] = output;
    pixels[index + 1] = output;
    pixels[index + 2] = output;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
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

const primaryButton = { minHeight: "2.25rem", padding: "0 0.9rem", border: "1px solid #303030", borderRadius: "0.5rem", background: "#303030", color: "white", fontWeight: 600, cursor: "pointer" };
const secondaryButton = { ...primaryButton, background: "white", color: "#303030" };

export function ReceiptOcrScanner() {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [crop, setCrop] = useState<Crop>(DEFAULT_CROP);
  const [isScanning, setIsScanning] = useState(false);

  async function scanFile(targetFile: File, targetCrop = crop) {
    if (isScanning) return;
    setIsScanning(true);
    setStatus("Bon wordt uitgesneden en gelezen...");
    try {
      const Tesseract = await import("tesseract.js");
      const modes: ImageMode[] = ["balanced", "soft", "hard"];
      let bestText = "";
      let bestScore = -999;

      for (const mode of modes) {
        const processedImage = await preprocessReceiptImage(targetFile, targetCrop, mode);
        const result = await Tesseract.recognize(processedImage, "nld+eng", {
          logger: (message: { status?: string; progress?: number }) => {
            if (!message.status) return;
            const progress = message.progress ? ` ${Math.round(message.progress * 100)}%` : "";
            setStatus(`${mode}: ${message.status}${progress}`);
          },
        });
        const text = result.data.text || "";
        const score = receiptScore(text);
        if (score > bestScore) {
          bestScore = score;
          bestText = text;
        }
      }

      if (bestScore < 8) {
        setStatus(`Te veel ruis. Score ${bestScore}. Zet het kader strakker om alleen de bon en scan opnieuw.`);
        return;
      }

      applyResult(bestText);
      setStatus(`Bon is uitgelezen met score ${bestScore}. Controleer de velden en klik op Kosten boeken.`);
    } catch (error) {
      setStatus(`OCR mislukt: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsScanning(false);
    }
  }

  function handleFile(nextFile?: File) {
    if (!nextFile) return;
    setFile(nextFile);
    setCrop(DEFAULT_CROP);
    setStatus("Foto geladen. Zet het paarse kader strak om de bon en klik daarna op Scan bon.");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(nextFile));
  }

  const cropStyle = {
    position: "absolute" as const,
    top: `${crop.top}%`,
    right: `${crop.right}%`,
    bottom: `${crop.bottom}%`,
    left: `${crop.left}%`,
    border: "3px solid #4f46e5",
    borderRadius: "0.75rem",
    boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.42)",
    pointerEvents: "none" as const,
  };

  const updateCrop = (key: keyof Crop, value: number) => {
    setCrop((current) => ({ ...current, [key]: Math.max(0, Math.min(45, value)) }));
  };

  return (
    <div style={{ display: "grid", gap: "0.75rem", marginBottom: "1rem" }}>
      <input ref={uploadInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(event) => handleFile(event.currentTarget.files?.[0])} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(event) => handleFile(event.currentTarget.files?.[0])} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
        <button type="button" style={primaryButton} onClick={() => cameraInputRef.current?.click()} disabled={isScanning}>Foto maken</button>
        <button type="button" style={secondaryButton} onClick={() => uploadInputRef.current?.click()} disabled={isScanning}>Bon uploaden</button>
        {file ? <button type="button" style={primaryButton} onClick={() => scanFile(file)} disabled={isScanning}>{isScanning ? "Scannen..." : "Scan bon"}</button> : null}
      </div>

      {status ? <s-banner tone="warning">{status}</s-banner> : null}

      {previewUrl ? (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <div style={{ position: "relative", width: "fit-content", maxWidth: "100%" }}>
            <img src={previewUrl} alt="Bon preview" style={{ display: "block", maxWidth: "100%", maxHeight: "420px", borderRadius: "1rem", border: "1px solid #e1e3e5" }} />
            <div style={cropStyle} />
          </div>
          <div style={{ display: "grid", gap: "0.5rem", maxWidth: "42rem" }}>
            <label>Boven uitsnijden: {crop.top}%</label>
            <input type="range" min="0" max="45" value={crop.top} disabled={isScanning} onChange={(event) => updateCrop("top", Number(event.currentTarget.value))} />
            <label>Onder uitsnijden: {crop.bottom}%</label>
            <input type="range" min="0" max="45" value={crop.bottom} disabled={isScanning} onChange={(event) => updateCrop("bottom", Number(event.currentTarget.value))} />
            <label>Links uitsnijden: {crop.left}%</label>
            <input type="range" min="0" max="45" value={crop.left} disabled={isScanning} onChange={(event) => updateCrop("left", Number(event.currentTarget.value))} />
            <label>Rechts uitsnijden: {crop.right}%</label>
            <input type="range" min="0" max="45" value={crop.right} disabled={isScanning} onChange={(event) => updateCrop("right", Number(event.currentTarget.value))} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
