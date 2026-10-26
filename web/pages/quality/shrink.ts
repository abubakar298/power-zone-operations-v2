/**
 * Shrink a site picture before it is uploaded (Moaz, 26 Oct 2026): the longest side becomes at most 2000 px and it is
 * saved as JPEG at good quality, so text on challans and labels stays readable. PDFs are sent as they are (8 MB max).
 */
export const MAX_SIDE = 2000;
export const QUALITY = 0.8;
export const MAX_BYTES = 8 * 1024 * 1024;
export type UploadMime = "image/jpeg" | "image/png" | "application/pdf";
export interface Prepared { filename: string; mime: UploadMime; base64: string; originalSize: number; size: number }

const base64Of = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
  r.onerror = () => reject(new Error("The file could not be read."));
  r.readAsDataURL(blob);
});

export async function prepareUpload(file: File): Promise<Prepared> {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 8 MB. Send a smaller PDF.`);
    return { filename: file.name, mime: "application/pdf", base64: await base64Of(file), originalSize: file.size, size: file.size };
  }
  if (!file.type.startsWith("image/")) throw new Error(`${file.name}: use photos (JPEG or PNG) or PDF files.`);
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bitmap) throw new Error(`${file.name} could not be opened. Use JPEG or PNG photos.`);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  if (!jpeg) throw new Error(`${file.name} could not be shrunk.`);
  // A small JPEG or PNG that would only grow is kept as it is.
  const keep = scale === 1 && jpeg.size >= file.size && (file.type === "image/jpeg" || file.type === "image/png");
  const out = keep ? file : jpeg;
  if (out.size > MAX_BYTES) throw new Error(`${file.name} is still larger than 8 MB after shrinking.`);
  const mime = (keep ? file.type : "image/jpeg") as UploadMime;
  const filename = keep ? file.name : `${file.name.replace(/\.[^.]+$/, "") || "picture"}.jpg`;
  return { filename, mime, base64: await base64Of(out), originalSize: file.size, size: out.size };
}
export const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
