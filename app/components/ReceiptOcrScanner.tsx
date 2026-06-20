import { useRef, useState } from "react";
import { Form } from "react-router";

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
  const [hasFile, setHasFile] = useState(false);

  function handleFile(nextFile?: File) {
    if (!nextFile || nextFile.size <= 0) return;
    setHasFile(true);
    setStatus("Foto geladen. Klik nu op ‘Lees bon met AI’. De pagina verwerkt de foto via een beveiligde formulier-post.");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(nextFile));
  }

  return (
    <Form method="post" encType="multipart/form-data" style={{ display: "grid", gap: "0.75rem", marginBottom: "1rem" }}>
      <input type="hidden" name="intent" value="ai-scan" />
      <input ref={uploadInputRef} name="receiptFileUpload" type="file" accept="image/*" style={{ display: "none" }} onChange={(event) => handleFile(event.currentTarget.files?.[0])} />
      <input ref={cameraInputRef} name="receiptFileCamera" type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(event) => handleFile(event.currentTarget.files?.[0])} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
        <button type="button" style={primaryButton} onClick={() => cameraInputRef.current?.click()}>Foto maken</button>
        <button type="button" style={secondaryButton} onClick={() => uploadInputRef.current?.click()}>Bon uploaden</button>
        {hasFile ? <button type="submit" style={primaryButton}>Lees bon met AI</button> : null}
      </div>

      {status ? <s-banner tone="warning">{status}</s-banner> : null}
      {previewUrl ? <img src={previewUrl} alt="Bon preview" style={{ display: "block", maxWidth: "100%", maxHeight: "420px", borderRadius: "1rem", border: "1px solid #e1e3e5" }} /> : null}
    </Form>
  );
}
