// Where the PDF reader finds its image decoders (copied to /pdfjs/wasm/ by scripts/ocr-assets.mjs at build).
// Scanner apps often save pages as JBIG2 (black and white) or JPEG 2000 images. Without these files the
// reader cannot decode them and draws a blank white page with no error (seen 27 Nov 2026 on the
// Storekeeper's "Preview chosen file").
export function documentReaderOptions(){return {wasmUrl:new URL('/pdfjs/wasm/',location.origin).href};}
