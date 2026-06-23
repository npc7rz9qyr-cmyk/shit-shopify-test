import { useState } from "react";
import { Form } from "react-router";

const MAX_UPLOAD_BYTES = 850 * 1024;
const MAX_DIMENSION = 1600;

type PreparedImage = {
  dataUrl: string;
  originalBytes: number;
  compressedBytes: number;
};

function dataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Bestand lezen mislukt"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Afbeelding laden mislukt"));
    image.src = src;
  });
}

async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Gebruik een JPG of PNG afbeelding. PDF-bestanden zijn vaak te groot voor OCR.space gratis API.");
  }

  const originalDataUrl = await readAsDataUrl(file);
  const image = await loadImage(originalDataUrl);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
  let width = Math.max(1, Math.round(image.width * scale));
  let height = Math.max(1, Math.round(image.height * scale));
  let quality = 0.82;
  let output = "";

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Afbeelding comprimeren mislukt");
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    output = canvas.toDataURL("image/jpeg", quality);

    if (dataUrlBytes(output) <= MAX_UPLOAD_BYTES) break;
    quality = Math.max(0.45, quality - 0.1);
    width = Math.max(1, Math.round(width * 0.88));
    height = Math.max(1, Math.round(height * 0.88));
  }

  const compressedBytes = dataUrlBytes(output);
  if (compressedBytes > MAX_UPLOAD_BYTES) {
    throw new Error("De afbeelding blijft te groot. Maak een foto dichterbij de bon, snijd de randen weg en probeer opnieuw.");
  }

  return { dataUrl: output, originalBytes: file.size, compressedBytes };
}

function formatKb(bytes: number) {
  return `${Math.round(bytes / 1024)} KB`;
}

const primaryButton = {
  minHeight: "2.5rem",
  padding: "0 1rem",
  border: "1px solid #303030",
  borderRadius: "0.65rem",
  background: "#303030",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButton = {
  ...primaryButton,
  background: "white",
  color: "#303030",
};

export function OcrSpaceUploadForm() {
  const [base64Image, setBase64Image] = useState("");
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function handleFile(file?: File) {
    setError("");
    setBase64Image("");
    setFileName("");
    if (!file) return;

    try {
      setStatus("Foto wordt verkleind...");
      const prepared = await prepareImage(file);
      setBase64Image(prepared.dataUrl);
      setFileName(file.name || "receipt.jpg");
      setStatus(`Klaar voor OCR: ${formatKb(prepared.originalBytes)} → ${formatKb(prepared.compressedBytes)}`);
    } catch (err) {
      setStatus("");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Form method="post" preventScrollReset>
      <input type="hidden" name="intent" value="ocr-space" />
      <input type="hidden" name="base64Image" value={base64Image} />
      <input type="hidden" name="fileName" value={fileName} />

      <div style={{ display: "grid", gap: "1rem", maxWidth: "42rem" }}>
        <div style={{ border: "1px dashed #8c9196", borderRadius: "1rem", padding: "1.25rem", background: "#fafafa", display: "grid", gap: "0.75rem" }}>
          <div style={{ fontWeight: 800, fontSize: "1rem" }}>Bon of factuur uploaden</div>
          <div style={{ color: "#616161", lineHeight: 1.5 }}>Kies een scherpe JPG/PNG-foto. De app verkleint de foto automatisch voordat OCR.space hem uitleest.</div>

          <input id="ocr-space-file" type="file" accept="image/*" onChange={(event) => handleFile(event.currentTarget.files?.[0])} style={{ display: "none" }} />

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
            <label htmlFor="ocr-space-file" style={secondaryButton}>Bon kiezen</label>
            <button type="submit" disabled={!base64Image} style={{ ...primaryButton, opacity: base64Image ? 1 : 0.45, cursor: base64Image ? "pointer" : "not-allowed" }}>
              Automatisch uitlezen
            </button>
          </div>

          <div style={{ fontSize: "0.9rem", color: fileName ? "#303030" : "#6b7280" }}>
            {fileName ? `Gekozen bestand: ${fileName}` : "Nog geen bestand gekozen"}
          </div>
        </div>

        {status ? <s-banner tone="success">{status}</s-banner> : null}
        {error ? <s-banner tone="critical">{error}</s-banner> : null}
      </div>
    </Form>
  );
}
