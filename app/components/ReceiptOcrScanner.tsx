import { useRef, useState } from "react";

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

const emptyReceipt: ReceiptData = {
  supplier: "",
  date: "",
  invoiceNumber: "",
  description: "",
  net: "",
  vat: "",
  total: "",
  vatRate: "21",
  rawText: "",
};

function setFormValue(name: string, value?: string) {
  if (!value) return;
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`);
  if (!element) return;
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function applyReceipt(receipt: ReceiptData) {
  setFormValue("receiptText", receipt.rawText);
  setFormValue("date", receipt.date);
  setFormValue("supplier", receipt.supplier);
  setFormValue("description", receipt.description || "Bon/factuur");
  setFormValue("invoiceNumber", receipt.invoiceNumber);
  setFormValue("net", receipt.net);
  setFormValue("vat", receipt.vat);
  setFormValue("total", receipt.total);
  setFormValue("vatRate", receipt.vatRate);
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
  const [file, setFile] = useState<File | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData>(emptyReceipt);

  function handleFile(nextFile?: File) {
    if (!nextFile) return;
    setFile(nextFile);
    setReceipt(emptyReceipt);
    setStatus("Foto geladen. Klik op ‘Lees bon met AI’ om de bon uit te lezen.");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(nextFile));
  }

  async function scanWithAi() {
    if (!file || isScanning) return;
    setIsScanning(true);
    setStatus("Bon wordt met AI gelezen...");

    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/app/receipt-ocr", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Bon lezen mislukt.");
      }

      const nextReceipt = { ...emptyReceipt, ...(data.receipt || {}) } as ReceiptData;
      setReceipt(nextReceipt);
      applyReceipt(nextReceipt);
      setStatus("Bon is gelezen. Controleer de gevonden velden en klik daarna op Kosten boeken.");
    } catch (error) {
      setStatus(`Bon lezen mislukt: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsScanning(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.75rem", marginBottom: "1rem" }}>
      <input ref={uploadInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(event) => handleFile(event.currentTarget.files?.[0])} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(event) => handleFile(event.currentTarget.files?.[0])} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
        <button type="button" style={primaryButton} onClick={() => cameraInputRef.current?.click()} disabled={isScanning}>Foto maken</button>
        <button type="button" style={secondaryButton} onClick={() => uploadInputRef.current?.click()} disabled={isScanning}>Bon uploaden</button>
        {file ? <button type="button" style={primaryButton} onClick={scanWithAi} disabled={isScanning}>{isScanning ? "Lezen..." : "Lees bon met AI"}</button> : null}
      </div>

      {status ? <s-banner tone="warning">{status}</s-banner> : null}
      {previewUrl ? <img src={previewUrl} alt="Bon preview" style={{ display: "block", maxWidth: "100%", maxHeight: "420px", borderRadius: "1rem", border: "1px solid #e1e3e5" }} /> : null}

      {receipt.rawText || receipt.total || receipt.supplier ? (
        <div style={{ display: "grid", gap: "0.75rem", padding: "1rem", border: "1px solid #e1e3e5", borderRadius: "1rem", background: "white" }}>
          <strong>Gevonden bongegevens</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", gap: "0.5rem" }}>
            <div><strong>Leverancier</strong><br />{receipt.supplier || "—"}</div>
            <div><strong>Datum</strong><br />{receipt.date || "—"}</div>
            <div><strong>Bon/factuur nr.</strong><br />{receipt.invoiceNumber || "—"}</div>
            <div><strong>Excl. btw</strong><br />{receipt.net || "—"}</div>
            <div><strong>Btw</strong><br />{receipt.vat || "—"}</div>
            <div><strong>Totaal</strong><br />{receipt.total || "—"}</div>
            <div><strong>Btw %</strong><br />{receipt.vatRate || "—"}</div>
          </div>
          <details>
            <summary>Ruwe gelezen tekst tonen</summary>
            <pre style={{ whiteSpace: "pre-wrap", overflowX: "auto", padding: "0.75rem", background: "#f6f6f7", borderRadius: "0.75rem" }}>{receipt.rawText || "Geen ruwe tekst ontvangen."}</pre>
          </details>
        </div>
      ) : null}
    </div>
  );
}
