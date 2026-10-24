import type { Pool, PoolClient } from "pg";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { zipSync } from "fflate";
import { HttpError } from "../http/errors.js";
import { transaction } from "../db/transaction.js";
import { drawReportFooter, drawReportLogo, reportBottomMargin } from "../reports/branding.js";
import { fixed, num, toDay } from "./supply.js";
import { xlsxBook, type Cell } from "./xlsx.js";
import type { ProcurementRepository } from "./repository.js";

type Db = Pool | PoolClient;
const NEW_NUMBER = "'RFQ-' || to_char(now(),'YY') || '-' || lpad(nextval('purchase_rfq_number')::text,3,'0')";
export const RFQ_REPLY_DAYS = 3;

export interface RfqItem { sr: number; itemKey: string; name: string; specification: string; unit: string; quantity: string }
export interface Rfq {
  id: string; number: string; requestId: string; requestNumber: string; dueOn: string; createdAt: string; createdBy: string;
  terms: string[]; items: RfqItem[]; contact: { name: string; email: string };
  vendors: { id: string; vendor: string; contact: string; repliedAt: string | null }[];
}

const clean = (v: unknown) => String(v ?? "").replaceAll("²", "2").replaceAll("×", "x").replace(/[–—]/g, "-").replace(/[^\n\x20-\x7e\xa0-\xff]/g, "");
const longDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const plusDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return toDay(x); };
export const safeFileName = (s: string) => s.replace(/[^A-Za-z0-9 ._-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "file";

/** Standard terms for a request, editable on each RFQ before it is made. Prices of other vendors are never shown. */
export function defaultTerms(r: { needed_by: unknown; delivery_to: string; payment_terms: string }) {
  return [
    "Quote unit rates in PKR, inclusive of all taxes. Where GST applies, show it separately.",
    `Delivery to ${r.delivery_to || "Power Zone Store"}${r.needed_by ? ` by ${longDay(toDay(r.needed_by))}` : ""}. State the delivery time in days for each item.`,
    r.payment_terms ? `Payment terms: ${r.payment_terms}.` : "State your payment terms.",
    "Keep the quotation valid for at least 15 days from the due date.",
    "You may quote for some items only. Equivalent brands are accepted if they meet the specification; state the brand or make offered.",
  ];
}

/**
 * Requests for quotation (Moaz, 24 Oct 2026). Hamza sends one tender-style requirement to several vendors at once:
 * one PDF and one Excel per vendor, with no prices, no last rates and no customer or site names.
 */
export class RfqRepository {
  constructor(private pool: Pool, private procurement: ProcurementRepository) {}

  private async who(actor: string, c: Db = this.pool) {
    const me = await this.procurement.me(actor, c);
    const email = (await c.query("SELECT email FROM users WHERE id=$1", [actor])).rows[0]?.email as string;
    return { ...me, email };
  }
  private async reader(actor: string, c: Db = this.pool) {
    const w = await this.who(actor, c);
    if (!w.buyer && !w.approver && !["Admin", "Management"].includes(w.role)) throw new HttpError(403, "Quotation requests belong to Procurement.");
    return w;
  }
  private async load(c: Db, ids: { rfqId?: string; requestId?: string }) {
    const rows = (await c.query(
      `SELECT f.*, r.number AS request_number, u.display_name AS created_by_name FROM purchase_rfqs f JOIN purchase_requests r ON r.id=f.request_id
       JOIN users u ON u.id=f.created_by WHERE ($1::uuid IS NULL OR f.id=$1) AND ($2::uuid IS NULL OR f.request_id=$2) ORDER BY f.created_at DESC`,
      [ids.rfqId ?? null, ids.requestId ?? null],
    )).rows;
    const vendors = rows.length ? (await c.query("SELECT * FROM purchase_rfq_vendors WHERE rfq_id = ANY($1) ORDER BY lower(vendor)", [rows.map((r) => r.id)])).rows : [];
    return rows.map((f): Rfq => ({
      id: f.id, number: f.number, requestId: f.request_id, requestNumber: f.request_number, dueOn: toDay(f.due_on), createdAt: f.created_at, createdBy: f.created_by_name,
      terms: f.terms, items: f.items, contact: f.contact,
      vendors: vendors.filter((v) => v.rfq_id === f.id).map((v) => ({ id: v.id, vendor: v.vendor, contact: v.contact, repliedAt: v.replied_at ?? null })),
    }));
  }

  async list(actor: string, requestId: string) {
    const w = await this.reader(actor);
    const r = (await this.pool.query("SELECT needed_by, delivery_to, payment_terms, status, kind FROM purchase_requests WHERE id=$1", [requestId])).rows[0];
    if (!r) throw new HttpError(404, "Purchase request not found.");
    const used = (await this.pool.query(
      "SELECT vendor FROM (SELECT DISTINCT ON (lower(btrim(vendor))) vendor, created_at FROM purchase_quotes ORDER BY lower(btrim(vendor)), created_at DESC) v ORDER BY created_at DESC LIMIT 40",
    )).rows.map((v) => v.vendor as string);
    return {
      rfqs: await this.load(this.pool, { requestId }),
      defaults: { dueOn: plusDays(new Date(), RFQ_REPLY_DAYS), terms: defaultTerms(r) },
      vendorsUsed: used,
      can: { create: w.buyer && r.status === "draft" && r.kind !== "direct" },
    };
  }

  async create(actor: string, requestId: string, input: { vendors: { name: string; contact: string }[]; dueOn: string; terms: string[] }) {
    const id = await transaction(this.pool, async (c) => {
      const w = await this.who(actor, c);
      if (!w.buyer) throw new HttpError(403, "Only the Procurement buyer sends quotation requests.");
      const r = (await c.query("SELECT status, kind FROM purchase_requests WHERE id=$1 FOR UPDATE", [requestId])).rows[0];
      if (!r) throw new HttpError(404, "Purchase request not found.");
      if (r.status !== "draft" || r.kind === "direct") throw new HttpError(422, "Quotations are asked for while the request is a draft.");
      const names = new Set<string>();
      for (const v of input.vendors) {
        const k = v.name.trim().toLowerCase();
        if (names.has(k)) throw new HttpError(400, `${v.name} is listed twice.`);
        names.add(k);
      }
      if (input.dueOn < toDay(new Date())) throw new HttpError(400, "The due date has passed.");
      const items = (await c.query(
        `SELECT l.item_key, l.quantity, l.unit, COALESCE(m.display_name, x.name, l.item_key) AS name, COALESCE(m.approved_specification, '') AS spec
         FROM purchase_request_lines l LEFT JOIN item_master m ON m.key=l.item_key LEFT JOIN misc_items x ON x.key=l.item_key
         WHERE l.request_id=$1 ORDER BY l.created_at, l.item_key`,
        [requestId],
      )).rows.map((l, i): RfqItem => ({ sr: i + 1, itemKey: l.item_key, name: l.name, specification: l.spec, unit: l.unit, quantity: fixed(num(l.quantity)) }));
      if (!items.length) throw new HttpError(422, "Add items to the request first.");
      const f = (await c.query(
        `INSERT INTO purchase_rfqs(number, request_id, due_on, terms, items, contact, created_by) VALUES(${NEW_NUMBER}, $1, $2, $3, $4, $5, $6) RETURNING id, number`,
        [requestId, input.dueOn, JSON.stringify(input.terms.filter((t) => t.trim())), JSON.stringify(items), JSON.stringify({ name: w.displayName, email: w.email }), actor],
      )).rows[0];
      for (const v of input.vendors)
        await c.query("INSERT INTO purchase_rfq_vendors(rfq_id, vendor, contact) VALUES($1,$2,$3)", [f.id, v.name.trim(), v.contact.trim()]);
      await c.query("INSERT INTO purchase_request_events(request_id,kind,from_status,to_status,note,created_by) VALUES($1,'rfq_sent','draft','draft',$2,$3)",
        [requestId, `${f.number} to ${input.vendors.map((v) => v.name.trim()).join(", ")}`, actor]);
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [actor, `procurement.rfq:${f.id}`]);
      return f.id as string;
    });
    return { rfq: (await this.load(this.pool, { rfqId: id }))[0], ...(await this.list(actor, requestId)) };
  }

  async rfq(actor: string, rfqId: string) {
    await this.reader(actor);
    const f = (await this.load(this.pool, { rfqId }))[0];
    if (!f) throw new HttpError(404, "Quotation request not found.");
    return f;
  }
}

// ----- documents -----
type Vendor = Rfq["vendors"][number];

export function buildRfqPdf(rfq: Rfq, vendor: Vendor) {
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  drawReportLogo(pdf);
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(12); pdf.setTextColor(30, 30, 40);
  pdf.text("REQUEST FOR QUOTATION", 14, 38);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(8);
  pdf.text("POWER ZONE ENGINEERING & SERVICES (PVT) LIMITED", 14, 44);
  autoTable(pdf, {
    startY: 49, theme: "grid", styles: { fontSize: 8, cellPadding: 2 }, columnStyles: { 0: { fontStyle: "bold", cellWidth: 34 }, 2: { fontStyle: "bold", cellWidth: 34 } },
    body: [
      ["RFQ number", rfq.number, "Date", longDay(toDay(rfq.createdAt))],
      ["To", clean(vendor.vendor) + (vendor.contact ? `\n${clean(vendor.contact)}` : ""), "Quotations due by", longDay(rfq.dueOn)],
      ["Our reference", rfq.requestNumber, "Contact", `${clean(rfq.contact.name)}${rfq.contact.email ? `\n${rfq.contact.email}` : ""}`],
    ],
  });
  let y = (pdf as any).lastAutoTable.finalY + 6;
  pdf.setFontSize(9);
  pdf.text(pdf.splitTextToSize("Please quote your best rates for the items below, on the terms listed. Fill in the rate, brand and delivery time for each item you can supply.", 182), 14, y);
  autoTable(pdf, {
    startY: y + 8, theme: "grid", margin: { bottom: reportBottomMargin },
    styles: { fontSize: 7.5, cellPadding: 1.6, valign: "top" }, headStyles: { fillColor: [40, 40, 60], fontSize: 7.5 },
    head: [["Sr", "Item ID", "Description", "Unit", "Qty", "Unit rate (PKR)", "Total (PKR)", "Brand / make", "Delivery (days)"]],
    body: rfq.items.map((i) => [i.sr, clean(i.itemKey), clean(i.name) + (i.specification ? `\n${clean(i.specification)}` : ""), clean(i.unit), i.quantity, "", "", "", ""]),
    columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 26 }, 2: { cellWidth: 52 }, 3: { cellWidth: 12 }, 4: { cellWidth: 12, halign: "right" }, 5: { cellWidth: 20 }, 6: { cellWidth: 20 }, 7: { cellWidth: 18 }, 8: { cellWidth: 14 } },
  });
  y = (pdf as any).lastAutoTable.finalY + 7;
  const ensure = (h: number) => { if (y + h > 297 - reportBottomMargin) { pdf.addPage(); y = 20; } };
  ensure(10); pdf.setFont("helvetica", "bold"); pdf.text("Terms", 14, y); pdf.setFont("helvetica", "normal"); y += 5;
  rfq.terms.forEach((t, i) => { const lines = pdf.splitTextToSize(`${i + 1}. ${clean(t)}`, 182); ensure(lines.length * 4 + 1); pdf.text(lines, 14, y); y += lines.length * 4 + 1; });
  const reply = pdf.splitTextToSize(`Send your quotation to ${clean(rfq.contact.name)}${rfq.contact.email ? ` (${rfq.contact.email})` : ""} by ${longDay(rfq.dueOn)}, quoting ${rfq.number}. You may fill in the Excel sheet sent with this request and return it.`, 182);
  ensure(reply.length * 4 + 6); y += 3; pdf.setFont("helvetica", "bold"); pdf.text(reply, 14, y);
  drawReportFooter(pdf, `${rfq.number} · ${clean(vendor.vendor)}`);
  return Buffer.from(pdf.output("arraybuffer"));
}

/** The vendor fills in columns G to K; row 8 is the header the upload reads back. */
export const RFQ_HEADER = ["Sr", "Item ID", "Description", "Specification", "Unit", "Quantity", "Unit rate (PKR)", "Total (PKR)", "Brand / make", "Delivery (days)", "Remarks"];
export function buildRfqXlsx(rfq: Rfq, vendor: Vendor) {
  const b = (v: string): Cell => ({ v, bold: true });
  const first = 9;
  const rows: Cell[][] = [
    [b("Power Zone Engineering & Services (Pvt) Limited — Request for Quotation")],
    [b("RFQ number"), rfq.number, null, b("Date"), longDay(toDay(rfq.createdAt))],
    [b("To"), vendor.vendor, null, b("Quotations due by"), longDay(rfq.dueOn)],
    [b("Our reference"), rfq.requestNumber, null, b("Contact"), `${rfq.contact.name}${rfq.contact.email ? ` · ${rfq.contact.email}` : ""}`],
    [],
    ["Fill in the unit rate, brand and delivery time for each item you can supply, then send this file back."],
    [],
    RFQ_HEADER.map(b),
    ...rfq.items.map((i, n): Cell[] => [i.sr, i.itemKey, i.name, i.specification, i.unit, Number(i.quantity), null, { f: `IF(G${first + n}="","",F${first + n}*G${first + n})` }, null, null, null]),
    [],
    [b("Terms")],
    ...rfq.terms.map((t, i): Cell[] => [`${i + 1}. ${t}`]),
  ];
  return xlsxBook([{ name: "RFQ", rows, widths: [6, 22, 34, 34, 8, 10, 16, 16, 18, 14, 24] }]);
}

export function buildRfqZip(rfq: Rfq) {
  const files: Record<string, Uint8Array> = {};
  for (const v of rfq.vendors) {
    const base = safeFileName(`${rfq.number} ${v.vendor}`);
    files[`${base}.pdf`] = new Uint8Array(buildRfqPdf(rfq, v));
    files[`${base}.xlsx`] = new Uint8Array(buildRfqXlsx(rfq, v));
  }
  return Buffer.from(zipSync(files, { level: 6 }));
}

// ----- comparative statement -----
type Detail = Awaited<ReturnType<ProcurementRepository["getRequest"]>>;
function comparison(d: Detail) {
  const vendors = [...new Map(d.lines.flatMap((l) => l.quotes.map((q) => [q.vendor.trim().toLowerCase(), q.vendor] as const))).values()].sort((a, b) => a.localeCompare(b));
  const rows = d.lines.map((l, i) => {
    const rates = vendors.map((v) => l.quotes.find((q) => q.vendor.trim().toLowerCase() === v.trim().toLowerCase())?.rate ?? null);
    const quoted = rates.filter((r): r is string => r != null).map(Number);
    return { sr: i + 1, line: l, rates, lowest: quoted.length ? Math.min(...quoted) : null };
  });
  const totals = vendors.map((_, n) => {
    const q = rows.filter((r) => r.rates[n] != null);
    return { amount: q.reduce((t, r) => t + Number(r.rates[n]) * Number(r.line.quantity), 0), items: q.length };
  });
  return { vendors, rows, totals };
}

export function buildComparisonPdf(d: Detail) {
  const c = comparison(d);
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  drawReportLogo(pdf);
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(12); pdf.setTextColor(30, 30, 40);
  pdf.text("COMPARATIVE STATEMENT OF QUOTATIONS", 14, 38);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(8);
  pdf.text(clean(`${d.number} · ${d.title} · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Karachi" })}`), 14, 44);
  const money = (v: number | string | null) => (v == null ? "-" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }));
  autoTable(pdf, {
    startY: 50, theme: "grid", margin: { bottom: reportBottomMargin },
    styles: { fontSize: c.vendors.length > 4 ? 6 : 7, cellPadding: 1.4, valign: "top" }, headStyles: { fillColor: [40, 40, 60] },
    head: [["Sr", "Item", "Qty", "Last rate", ...c.vendors.map(clean), "Chosen", "Line total"]],
    body: [
      ...c.rows.map((r) => [r.sr, clean(`${r.line.name}\n${r.line.itemKey}`), `${r.line.quantity} ${clean(r.line.unit)}`, r.line.lastRate ? money(r.line.lastRate.rate) : "-",
        ...r.rates.map(money), r.line.chosen ? clean(`${r.line.chosen.vendor}\n${money(r.line.chosen.rate)}`) : "-", money(r.line.lineTotal)]),
      ["", "Total of items quoted", "", "", ...c.totals.map((t) => `${money(t.amount)}\n${t.items} of ${c.rows.length} items`), "", money(d.totals.atChosen)],
    ],
    didParseCell: (h) => {
      const r = c.rows[h.row.index], v = h.column.index - 4;
      if (h.section === "body" && r && v >= 0 && v < c.vendors.length && r.rates[v] != null && Number(r.rates[v]) === r.lowest) {
        h.cell.styles.fontStyle = "bold"; h.cell.styles.fillColor = [226, 245, 233];
      }
      if (h.section === "body" && h.row.index === c.rows.length) h.cell.styles.fontStyle = "bold";
    },
  });
  const y = (pdf as any).lastAutoTable.finalY + 6;
  pdf.setFontSize(7.5);
  pdf.text("Lowest rate per item shaded. Chosen = the quotation on the request; the lowest is chosen unless the buyer picked another.", 14, Math.min(y, 297 - reportBottomMargin - 2));
  drawReportFooter(pdf, `${d.number} comparative statement`);
  return Buffer.from(pdf.output("arraybuffer"));
}

export function buildComparisonXlsx(d: Detail) {
  const c = comparison(d);
  const b = (v: string): Cell => ({ v, bold: true });
  const rows: Cell[][] = [
    [b(`Comparative statement of quotations — ${d.number} · ${d.title}`)],
    [],
    [b("Sr"), b("Item ID"), b("Item"), b("Unit"), b("Quantity"), b("Last rate"), ...c.vendors.map(b), b("Chosen vendor"), b("Chosen rate"), b("Line total")],
    ...c.rows.map((r): Cell[] => [r.sr, r.line.itemKey, r.line.name, r.line.unit, Number(r.line.quantity), r.line.lastRate ? Number(r.line.lastRate.rate) : null,
      ...r.rates.map((v): Cell => (v == null ? null : { v: Number(v), bold: Number(v) === r.lowest })), r.line.chosen?.vendor ?? null,
      r.line.chosen ? Number(r.line.chosen.rate) : null, Number(r.line.lineTotal)]),
    [null, null, b("Total of items quoted"), null, null, null, ...c.totals.map((t): Cell => ({ v: Number(fixed(t.amount)), bold: true })), null, null, { v: Number(d.totals.atChosen), bold: true }],
    [null, null, "Items quoted", null, null, null, ...c.totals.map((t) => `${t.items} of ${c.rows.length}`)],
    [],
    ["Bold = lowest rate for the item."],
  ];
  return xlsxBook([{ name: "Comparison", rows, widths: [6, 22, 34, 8, 10, 12, ...c.vendors.map(() => 14), 18, 12, 14] }]);
}
