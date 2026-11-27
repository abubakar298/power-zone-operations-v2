import {departmentFetch} from '../department-view.js';
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button.js";
import {downloadName,filenameFromDisposition} from '../../shared/download-name.js';
import pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import {showPdfPages,type PdfPagesView} from "./document-page-drawing.js";

/** Read-only authenticated document preview. Existing endpoints enforce access. */
export function DocumentPreview({
  url,
  title,
  mime = "application/pdf",
  data,
  onReady,
  downloadFilename,
  compactControls = false,
  showDownload = true,
}: {
  url: string;
  title: string;
  mime?: string;
  data?: Blob;
  onReady?: () => void;
  downloadFilename?:string;
  compactControls?:boolean;
  /** Off for a file that is only on the user's computer (chosen, not uploaded yet). */
  showDownload?:boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [retry, setRetry] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [status, setStatus] = useState("Loading document…");
  // The file this preview loaded, so Download can reuse it instead of fetching it again.
  const [loaded, setLoaded] = useState<{blob: Blob; filename?: string}>();
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let task: any;
    let pages: PdfPagesView | undefined;
    host.current?.replaceChildren();
    setLoaded(undefined);
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
          if (cancelled) return;
          setLoaded({blob, filename: filenameFromDisposition(response.headers.get('Content-Disposition'))});
        }
        const media = blob.type.toLowerCase();
        // Say so plainly instead of showing a PDF reader error for files the viewer cannot draw.
        if (media && !mime.startsWith("image/") && (media === "image/heic" || media === "image/heif" || !(media.includes("pdf") || media.startsWith("image/") || media.includes("spreadsheetml") || media === "application/octet-stream")))
          throw new Error("This file type cannot be previewed here. Use Download to open it.");
        if (blob.type.includes('spreadsheetml') || /\.xlsx$/i.test(downloadFilename??title)) {
          const {workbookPreview}=await import('./workbook-preview.js');const view=workbookPreview(new Uint8Array(await blob.arrayBuffer()));if(cancelled)return;host.current?.replaceChildren(view);
        } else if (blob.type.startsWith("image/") || mime.startsWith("image/")) {
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
          const pdf = await import("pdfjs-dist/legacy/build/pdf.mjs");
          pdf.GlobalWorkerOptions.workerSrc = pdfWorker;
          task = pdf.getDocument({ data: await blob.arrayBuffer() });
          const doc = await task.promise;
          if (cancelled || !host.current) return;
          // Page 1 first, later pages as they are scrolled to. Callers waiting for the whole document
          // (onReady, e.g. Survey Dispatch printing the drawn pages) still get every page drawn.
          pages = await showPdfPages(doc, host.current, title, {drawAll: Boolean(onReady)});
          if (cancelled) return pages.stop();
          await pages.ready;
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
      pages?.stop();
      void task?.destroy();
    };
  }, [url, title, mime, data, retry]);
  return (
    <section className="ipo-document-preview" aria-label={title}>
      <div className="ipo-preview-heading">
        <h4>{title}</h4>
        {showDownload && <DocumentDownload url={url} title={title} data={data ?? loaded?.blob} downloadFilename={loaded?.filename ?? downloadFilename}/>}
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
        !blob.type.startsWith("image/") && !blob.type.includes("spreadsheetml")
      )
        throw new Error("Unable to download this document. Please try again.");
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename??downloadName({documentType:title,identity:url.startsWith('blob:')?title:url,extension:blob.type.includes('spreadsheetml')?'xlsx':blob.type.startsWith('image/')?blob.type.split('/')[1]:'pdf'});
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
