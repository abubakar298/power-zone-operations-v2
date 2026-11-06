import { createWorker } from "tesseract.js";
import pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
export async function extractText(file: File, progress: (s: string) => void, tableMode=false, maxPdfPages=5) {
  if (file.type === "text/plain")
    return { text: await file.text(), confidence: null };
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  async function recognize(image: File | HTMLCanvasElement, singleLine=false) {
    worker ??= await createWorker("eng", 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr",
      langPath: "/ocr",
      logger: (m) => {
        if (m.status)
          progress(`${m.status} ${Math.round((m.progress ?? 0) * 100)}%`);
      },
    });
    if(tableMode)await worker.setParameters({tessedit_pageseg_mode:(singleLine?7:6) as any});
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
      if(tableMode){
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d')!;context.drawImage(image,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;const borders:number[]=[];let last=-10;
        for(let y=0;y<canvas.height;y++){let dark=0;for(let x=0;x<canvas.width;x+=2){const i=(y*canvas.width+x)*4;if((pixels[i]+pixels[i+1]+pixels[i+2])/3<90)dark++;}if(dark>canvas.width*.35){if(y-last>3)borders.push(y);last=y;}}
        if(borders.length>=3){const parts:string[]=[];for(let i=1;i<borders.length;i++){const height=borders[i]-borders[i-1]-6;if(height<20)continue;const strip=document.createElement('canvas');strip.width=canvas.width*3;strip.height=height*3;strip.getContext('2d')!.drawImage(canvas,0,borders[i-1]+3,canvas.width,height,0,0,strip.width,strip.height);progress(`Reading table row ${i}`);parts.push((await recognize(strip,true)).text.replace(/\n/g,' '));strip.width=0;strip.height=0;}image.close();canvas.width=0;canvas.height=0;return{text:parts.join('\n'),confidence:null};}canvas.width=0;canvas.height=0;
      }
      try {
        const d = await recognize(file);
        // Small photographed forms can look empty to automatic layout detection.
        // Retry at readable scale while preserving the original uploaded bytes.
        if (image.width < 1200 && d.text.trim().length < 4000) {
          const scale = Math.min(3, 3200 / image.width, Math.sqrt(20000000 / (image.width * image.height)));
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
          try {
            const context=canvas.getContext("2d")!;context.imageSmoothingQuality="high";context.drawImage(image, 0, 0, canvas.width, canvas.height);
            await worker!.setParameters({tessedit_pageseg_mode:6 as any});
            const retry = await recognize(canvas);
            if (retry.text.trim().length > d.text.trim().length) return {text:retry.text,confidence:retry.confidence};
          } finally { canvas.width = 0; canvas.height = 0; }
        }
        return { text: d.text, confidence: d.confidence };
      } finally { image.close(); }
    }
    const pdf = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdf.GlobalWorkerOptions.workerSrc = pdfWorker;
    const loadingTask = pdf.getDocument({ data: await file.arrayBuffer() });
    const doc = await loadingTask.promise;
    try {
      if (doc.numPages > maxPdfPages)
        throw new Error(
          `Upload a PDF with up to ${maxPdfPages} pages, or split it into smaller files.`,
        );
      const parts: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        progress(`Reading page ${i} of ${doc.numPages}`);
        const page = await doc.getPage(i),
          text = await page.getTextContent();
        const lines=new Map<number,{x:number;text:string}[]>();
        for(const item of text.items){if(!('str' in item))continue;const y=Math.round(item.transform[5]/3)*3;const line=lines.get(y)??[];line.push({x:item.transform[4],text:item.str});lines.set(y,line);}
        let value=[...lines.entries()].sort(([a],[b])=>b-a).map(([,line])=>line.sort((a,b)=>a.x-b.x).map(item=>item.text).join(' ')).join('\n');
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
