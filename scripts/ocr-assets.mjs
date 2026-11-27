import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  mkdir,
  copyFile,
  readdir,
  writeFile,
  readFile,
} from "node:fs/promises";
const require = createRequire(import.meta.url),
  out = "dist/web/ocr";
await mkdir(out, { recursive: true });
const core = dirname(require.resolve("tesseract.js-core/package.json"));
for (const name of await readdir(core))
  if (name.endsWith(".wasm.js") || name.endsWith(".wasm"))
    await copyFile(join(core, name), join(out, name));
await copyFile(
  join(
    dirname(require.resolve("tesseract.js/package.json")),
    "dist/worker.min.js",
  ),
  join(out, "worker.min.js"),
);
const lang = require("@tesseract.js-data/eng");
await copyFile(
  join(lang.langPath, "eng.traineddata.gz"),
  join(out, "eng.traineddata.gz"),
);
await writeFile(
  join(out, "LICENSES.txt"),
  await Promise.all(
    ["tesseract.js", "tesseract.js-core", "@tesseract.js-data/eng"].map(
      async (p) =>
        `${p}\n${await readFile(join(dirname(require.resolve(p + "/package.json")), "LICENSE"), "utf8").catch(() => "See package license in installed dependency.")}`,
    ),
  ).then((x) => x.join("\n\n")),
);

// PDF reader image decoders (JBIG2, JPEG 2000, colour profiles). Previews point the reader at
// /pdfjs/wasm/ (web/components/document-reader-assets.ts); without these files scanned pages
// saved in those formats show as blank white pages.
const pdfReader = join(dirname(require.resolve("pdfjs-dist/package.json")), "wasm"),
  pdfReaderOut = "dist/web/pdfjs/wasm";
await mkdir(pdfReaderOut, { recursive: true });
for (const name of await readdir(pdfReader))
  if (!name.startsWith("quickjs")) await copyFile(join(pdfReader, name), join(pdfReaderOut, name));
