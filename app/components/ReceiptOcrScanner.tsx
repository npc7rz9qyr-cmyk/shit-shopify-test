import { useRef, useState } from "react";

export function ReceiptOcrScanner() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState("");

  function showPreview(file?: File) {
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
  }

  const primaryButton = { minHeight: "2.25rem", padding: "0 0.9rem", border: "1px solid #303030", borderRadius: "0.5rem", background: "#303030", color: "white", fontWeight: 600, cursor: "pointer" };
  const secondaryButton = { ...primaryButton, background: "white", color: "#303030" };

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <s-banner tone="warning">Gebruik Live Text of Google Lens op je telefoon, plak daarna de tekst hieronder en klik op Bontekst uitlezen.</s-banner>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(event) => showPreview(event.currentTarget.files?.[0])} />
      <input ref={uploadRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(event) => showPreview(event.currentTarget.files?.[0])} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
        <button type="button" style={primaryButton} onClick={() => cameraRef.current?.click()}>Foto maken</button>
        <button type="button" style={secondaryButton} onClick={() => uploadRef.current?.click()}>Bon uploaden</button>
      </div>
      {previewUrl ? <img src={previewUrl} alt="Bon preview" style={{ display: "block", maxWidth: "100%", maxHeight: "420px", borderRadius: "1rem", border: "1px solid #e1e3e5" }} /> : null}
    </div>
  );
}
