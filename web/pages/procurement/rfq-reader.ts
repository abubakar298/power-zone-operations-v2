import { strFromU8, unzipSync } from "fflate";

export interface RfqReplyRow { itemKey: string; rate: string; note: string }

/**
 * Reads a vendor's filled RFQ Excel in the browser (Moaz, 24 Oct 2026): the "Item ID" and "Unit rate (PKR)" columns,
 * plus brand, delivery days and remarks as the quotation note. Works whether the vendor saved it in Excel or elsewhere.
 */
export function readRfqReply(bytes: Uint8Array): { vendor: string | null; rows: RfqReplyRow[] } {
  let size = 0;
  const files = unzipSync(bytes, {
    filter: (f) => {
      const wanted = /^xl\/(sharedStrings\.xml|worksheets\/sheet1\.xml)$/.test(f.name);
      if (wanted && (size += f.originalSize) > 8_000_000) throw Error("The Excel file is too large.");
      return wanted;
    },
  });
  const xml = (data: Uint8Array) => {
    const text = strFromU8(data);
    if (/<!DOCTYPE/i.test(text)) throw Error("This Excel file cannot be read.");
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) throw Error("This Excel file cannot be read.");
    return doc;
  };
  const sheet = files["xl/worksheets/sheet1.xml"];
  if (!sheet) throw Error("No worksheet found in the file.");
  const shared = files["xl/sharedStrings.xml"]
    ? [...xml(files["xl/sharedStrings.xml"]).getElementsByTagName("si")].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent ?? "").join(""))
    : [];
  const grid: string[][] = [];
  for (const row of [...xml(sheet).getElementsByTagName("row")]) {
    const values: string[] = [];
    for (const c of [...row.getElementsByTagName("c")]) {
      const letters = (c.getAttribute("r") ?? "").replace(/\d+/g, "");
      let at = 0;
      for (const ch of letters) at = at * 26 + (ch.charCodeAt(0) - 64);
      const type = c.getAttribute("t");
      const v = type === "s" ? shared[Number(c.getElementsByTagName("v")[0]?.textContent ?? -1)] ?? ""
        : type === "inlineStr" ? [...c.getElementsByTagName("t")].map((t) => t.textContent ?? "").join("")
        : c.getElementsByTagName("v")[0]?.textContent ?? "";
      values[at > 0 ? at - 1 : values.length] = v.trim();
    }
    grid.push(values);
  }
  const h = grid.findIndex((r) => r.some((v) => /^item id$/i.test(v ?? "")) && r.some((v) => /unit rate/i.test(v ?? "")));
  if (h < 0) throw Error("This is not a Power Zone RFQ sheet: the Item ID and Unit rate columns were not found.");
  const head = grid[h].map((v) => (v ?? "").toLowerCase());
  const col = (re: RegExp) => head.findIndex((v) => re.test(v));
  const c = { key: col(/^item id$/), rate: col(/unit rate/), brand: col(/brand/), days: col(/delivery/), remarks: col(/remark/) };
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const rows = grid.slice(h + 1).flatMap((r) => {
    const itemKey = cell(r, c.key), raw = cell(r, c.rate).replace(/,/g, "").replace(/^pkr\s*/i, "");
    if (!itemKey || !raw || Number.isNaN(Number(raw)) || Number(raw) < 0) return [];
    const note = [cell(r, c.brand) && `Brand: ${cell(r, c.brand)}`, cell(r, c.days) && `Delivery: ${cell(r, c.days)} days`, cell(r, c.remarks)].filter(Boolean).join(" · ");
    return [{ itemKey, rate: String(Math.round(Number(raw) * 1e4) / 1e4), note: note.slice(0, 500) }];
  });
  const vendor = grid.find((r) => /^to$/i.test(r[0] ?? ""))?.[1] ?? null;
  return { vendor, rows };
}
