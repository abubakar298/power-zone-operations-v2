import {departmentFetch} from '../department-view.js';
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button.js";
import {downloadName,filenameFromDisposition} from '../../shared/download-name.js';
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/** Read-only authenticated document preview. Existing endpoints enforce access. */
export function DocumentPreview({
  url,
  title,
  mime = "application/pdf",
  data,
  onReady,
  downloadFilename,
  compactControls = false,
}: {
  url: string;
  title: string;
  mime?: string;
  data?: Blob;
  onReady?: () => void;
  downloadFilename?:string;
  compactControls?:boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [retry, setRetry] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [status, setStatus] = useState("Loading document…");
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let task: any;
    host.current?.replaceChildren();
    setStatus("Loading document…");
    void (async () => {
      try {
        let blob = data;
        if (!blob) {
          const response = await departmentFetch(url, {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok)
            throw new Error(
              "Unable to load this document. Use the download link or try again.",
            );
          blob = await response.blob();
        }
        if (blob.type.startsWith("image/") || mime.startsWith("image/")) {
          const image = document.createElement("img");
          image.alt = title;
          const reader = new FileReader();
          reader.readAsDataURL(blob);
          await new Promise<void>((resolve, reject) => {
            reader.onload = () => resolve();
            reader.onerror = () =>
              reject(new Error("Unable to read attachment."));
          });
          if (cancelled) return;
          image.src = String(reader.result);
          host.current?.replaceChildren(image);
        } else {
          const pdf = await import("pdfjs-dist");
          pdf.GlobalWorkerOptions.workerSrc = pdfWorker;
          task = pdf.getDocument({ data: await blob.arrayBuffer() });
          const doc = await task.promise;
          for (let n = 1; n <= doc.numPages; n++) {
            if (cancelled) return;
            const page = await doc.getPage(n),
              viewport = page.getViewport({ scale: 1.25 });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({
              canvas,
              canvasContext: canvas.getContext("2d")!,
              viewport,
            }).promise;
            if (cancelled) return;
            const image = document.createElement("img");
            image.alt = `${title} · page ${n}`;
            image.src = canvas.toDataURL("image/png");
            host.current?.append(image);
          }
        }
        if (!cancelled) {setStatus("");onReady?.();}
      } catch (e) {
        if (!cancelled)
          setStatus(
            e instanceof Error ? e.message : "Unable to load document.",
          );
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      void task?.destroy();
    };
  }, [url, title, mime, data, retry]);
  return (
    <section className="ipo-document-preview" aria-label={title}>
      <div className="ipo-preview-heading">
        <h4>{title}</h4>
        <DocumentDownload url={url} title={title} data={data} />
      </div>
      {compactControls ? <div className="ipo-preview-toolbar" role="group" aria-label={title + " zoom controls"}>
        <div className="ipo-preview-zoom-group">
          <Button variant="neutral" aria-label="Zoom out" title="Zoom out" disabled={zoom <= 50} onClick={() => setZoom(v => v - 25)}>−</Button>
          <span className="ipo-preview-zoom-value" aria-live="polite" aria-atomic="true">{zoom}%</span>
          <Button variant="neutral" aria-label="Zoom in" title="Zoom in" disabled={zoom >= 250} onClick={() => setZoom(v => v + 25)}>+</Button>
        </div>
        <Button variant="neutral" onClick={() => setZoom(100)}>Fit width</Button>
      </div> : (
      <div className="pz-action-row" aria-label={title + " zoom controls"}>
        <Button
          variant="neutral"
          disabled={zoom <= 50}
          onClick={() => setZoom((v) => v - 25)}
        >
          Zoom out
        </Button>
        <span aria-live="polite">{zoom}%</span>
        <Button
          variant="neutral"
          disabled={zoom >= 250}
          onClick={() => setZoom((v) => v + 25)}
        >
          Zoom in
        </Button>
        <Button variant="neutral" onClick={() => setZoom(100)}>
          Fit width
        </Button>
      </div>
      )}
      {status && <p role="status">{status}</p>}
      {status && status !== "Loading document…" && (
        <Button variant="secondary" onClick={() => setRetry((v) => v + 1)}>
          Retry preview
        </Button>
      )}
      <div className="ipo-preview-pages">
        <div style={{ width: zoom + "%" }} ref={host} />
      </div>
    </section>
  );
}

export function DocumentDownload({
  url,
  title,
  data,
  label = "Download",
  downloadFilename,
}: {
  url: string;
  title: string;
  data?: Blob;
  label?: string;
  downloadFilename?:string;
}) {
  const [downloadError, setDownloadError] = useState("");
  const [downloading, setDownloading] = useState(false);
  async function download() {
    setDownloadError("");
    setDownloading(true);
    try {
      let blob = data;
      let filename=downloadFilename;
      if (!blob) {
        const response = await departmentFetch(url, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok)
          throw new Error(
            "Unable to download this document. Please try again.",
          );
        blob = await response.blob();
        filename=filenameFromDisposition(response.headers.get('Content-Disposition'))??filename;
      }
      if (
        !blob.type.includes("application/pdf") &&
        !blob.type.startsWith("image/")
      )
        throw new Error("Unable to download this document. Please try again.");
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename??downloadName({documentType:title,identity:url.startsWith('blob:')?title:url,extension:blob.type.startsWith('image/')?blob.type.split('/')[1]:'pdf'});
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (e) {
      setDownloadError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }
  return (
    <div>
      <Button
        variant="secondary"
        loading={downloading}
        onClick={() => void download()}
      >
        {label}
      </Button>
      {downloadError && (
        <p role="alert" className="form-error">
          {downloadError}
        </p>
      )}
    </div>
  );
}
