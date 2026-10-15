import { useEffect, useState } from "react";
import{filenameFromDisposition}from'../../shared/download-name.js';
export function SharePdf({ url, filename }: { url: string; filename: string }) {
  const [file, setFile] = useState<File>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    setFile(undefined);
    setMessage("");
  }, [url]);
  async function prepare() {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(url, { credentials: "same-origin" });
      if (!r.ok) throw new Error("Unable to prepare PDF.");
      const blob = await r.blob();
      if (!blob.type.includes("application/pdf"))
        throw new Error("The response is not a PDF.");
      setFile(new File([blob], filenameFromDisposition(r.headers.get('Content-Disposition'))??filename, { type: "application/pdf" }));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to prepare PDF.");
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    if (!file) return;
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        setMessage(
          "Share chooser closed. Check WhatsApp to confirm your message was sent.",
        );
      } else {
        const u = URL.createObjectURL(file),
          a = document.createElement("a");
        a.href = u;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(u), 1000);
        setMessage(
          "PDF downloaded. Open WhatsApp Desktop or Web, choose your chat and attach the downloaded PDF.",
        );
      }
    } catch (e) {
      setMessage(
        e instanceof DOMException && e.name === "AbortError"
          ? "Sharing cancelled. The document workflow is unchanged."
          : "Sharing unavailable. Use the PDF download and attach it in WhatsApp.",
      );
    }
  }
  return (
    <span className="pdf-share">
      {!file ? (
        <button type="button" disabled={busy} onClick={() => void prepare()}>
          {busy ? "Preparing PDF…" : "Prepare PDF for WhatsApp / sharing"}
        </button>
      ) : (
        <button type="button" onClick={() => void share()}>
          Share PDF / download for WhatsApp
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </span>
  );
}
