import { createWorker } from "tesseract.js";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
export async function extractText(file: File, progress: (s: string) => void) {
  if (file.type === "text/plain")
    return { text: await file.text(), confidence: null };
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  async function recognize(image: File | HTMLCanvasElement) {
    worker ??= await createWorker("eng", 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr",
      langPath: "/ocr",
      logger: (m) => {
        if (m.status)
          progress(`${m.status} ${Math.round((m.progress ?? 0) * 100)}%`);
      },
    });
    const result = await worker.recognize(image);
    return result.data;
  }
  try {
    if (file.type !== "application/pdf") {
      const image = await createImageBitmap(file);
      if (image.width * image.height > 20000000) {
        image.close();
        throw new Error(
          "Image is too large to process. Resize it to 20 megapixels or less.",
        );
      }
      image.close();
      const d = await recognize(file);
      return { text: d.text, confidence: d.confidence };
    }
    const pdf = await import("pdfjs-dist");
    pdf.GlobalWorkerOptions.workerSrc = pdfWorker;
    const loadingTask = pdf.getDocument({ data: await file.arrayBuffer() });
    const doc = await loadingTask.promise;
    try {
      if (doc.numPages > 5)
        throw new Error(
          "Upload a PDF with up to 5 pages, or split the survey into smaller files.",
        );
      const parts: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        progress(`Reading page ${i} of ${doc.numPages}`);
        const page = await doc.getPage(i),
          text = await page.getTextContent();
        let value = text.items.map((x) => ("str" in x ? x.str : "")).join("\n");
        if (value.trim().length < 30) {
          const viewport = page.getViewport({ scale: 1.5 });
          if (viewport.width * viewport.height > 20000000)
            throw new Error("PDF page is too large to process.");
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({
            canvas,
            canvasContext: canvas.getContext("2d")!,
            viewport,
          }).promise;
          value = (await recognize(canvas)).text;
          canvas.width = 0;
          canvas.height = 0;
        }
        parts.push(value);
        page.cleanup();
      }
      return { text: parts.join("\n\n"), confidence: null };
    } finally {
      await loadingTask.destroy();
    }
  } finally {
    await worker?.terminate();
  }
}
export function surveySuggestions(text: string) {
  const out: Record<string, string> = {};
  for (const [field, label] of Object.entries({
    panelQty: "(?:panel\\s*(?:qty|quantity)|number of panels)",
    panelWattage: "(?:panel\\s*wattage|wattage per panel)",
    dcMetres: "(?:dc\\s*cable\\s*(?:total|metres|meters|length))",
    earth25:
      "(?:2[.]5\\s*(?:mm²|mm2|mm)\\s*(?:earth(?:ing)?)(?:\\s*cable)?(?:\\s*(?:metres|meters|length))?)",
    earth6:
      "(?:6\\s*(?:mm²|mm2|mm)\\s*earth(?:ing)?(?:\\s*cable)?(?:\\s*(?:metres|meters|length))?)",
    earth10:
      "(?:10\\s*(?:mm²|mm2|mm)\\s*earth(?:ing)?(?:\\s*cable)?(?:\\s*(?:metres|meters|length))?)",
    batteryKwh: "(?:total\\s*battery\\s*capacity|battery\\s*(?:capacity|kwh))",
  })) {
    const matches = [
      ...text.matchAll(
        new RegExp(`${label}\\s*[:=]\\s*([0-9]+(?:[.][0-9]+)?)`, "gi"),
      ),
    ];
    const values = [...new Set(matches.map((m) => m[1]))];
    if (values.length === 1) out[field] = values[0];
  }
  return out;
}
