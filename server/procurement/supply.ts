import type { Pool, PoolClient } from "pg";
import { SiteWorkflowRepository } from "../site-workflow/repository.js";

type Db = Pool | PoolClient;
/** BOQ lines that are services, not stock: labour, delivery, structure, earthing bores, lump sums. */
export const SERVICE_LINE = /^(labou?r|delivery|transport|installation|commissioning|civil|structure|earthing bore|misc)/i;
/** Batteries, BMS and inverters are not bought by the Procurement buyer (Moaz, 20 Oct 2026). */
export const NOT_BOUGHT_BY_BUYER = /^(bat|hyb|inv)|battery|bms|inverter/i;
export const boughtByBuyer = (key: string, name = key) => !NOT_BOUGHT_BY_BUYER.test(key) && !NOT_BOUGHT_BY_BUYER.test(name);
/** Misc site items (MSC-…) sit outside the rate master so they stay off BOQs and quotations (Moaz, 24 Oct 2026). */
export const isMiscItem = (key: string) => /^MSC-\d+$/.test(key);
/** Every item Procurement and Store can use: the rate master plus the active misc items. */
export const PROCUREMENT_ITEMS = "(SELECT key, display_name, unit FROM item_master UNION ALL SELECT key, name, unit FROM misc_items WHERE active)";

export const num = (v: unknown) => (v == null ? 0 : Number(v));
/** Plain decimal text without trailing zeros: 12.500000 → "12.5". */
export const fixed = (v: number) => (Math.round(v * 1e6) / 1e6).toFixed(6).replace(/\.?0+$/, "").replace(/^-0$/, "0");
/** Units written differently for the same thing (MTRS, m; Nos, No.) compare as one. */
export function sameUnit(a: string, b: string) {
  const norm = (u: string) => {
    const x = u.trim().toLowerCase().replace(/\.$/, "");
    if (["m", "mtr", "mtrs", "meter", "meters", "metre", "metres", "rm"].includes(x)) return "m";
    if (["no", "nos", "pc", "pcs", "piece", "pieces", "unit", "units", "each"].includes(x)) return "no";
    return x;
  };
  return norm(a) === norm(b);
}
export function toDay(v: unknown) {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  return String(v).slice(0, 10);
}
const bigKind = (key: string) =>
  /pv module|solar panel/i.test(key) ? "panels" : /^bat|battery/i.test(key) ? "batteries" : /^hyb|inverter/i.test(key) ? "inverters" : null;

export interface ReceivedPo {
  issuanceId: string; ipoNumber: string; customer: string | null; siteName: string | null; siteCode: string | null; region: string | null;
  poDate: string | null; stage: string | null; deliveredOn: string | null; expectedDelivery: string | null;
  items: number; pending: boolean; shortItems: string[]; material: "delivered" | "short" | "ready";
}
export interface UpcomingPo {
  recordId: string; reference: string; customer: string | null; siteName: string | null; siteCode: string | null; region: string | null;
  workflowStage: string | null; expectedDate: string | null; items: number; bigItems: { panels: string; batteries: string; inverters: string }; updatedAt: string;
}
export interface InventoryRow {
  itemKey: string; name: string; unit: string; inRateMaster: boolean; misc: boolean; boughtByBuyer: boolean; counted: boolean; lastCountAt: string | null; stockUnit: string | null;
  inStock: string; receivedNeed: string; upcomingNeed: string; onOrder: string; requested: string; toBuy: string; shortForReceived: boolean; unitMismatch: boolean;
}
/** One site's need for an inverter, battery or BMS item, for Abu Bakar's watch. */
export interface WatchNeed { itemKey: string; label: string; kind: "received" | "upcoming"; date: string | null; qty: number }
export interface RateMasterItem { name: string; unit: string; rate: number | null; since: string | null }

export async function rateMaster(c: Db, keys: string[]) {
  if (!keys.length) return new Map<string, RateMasterItem>();
  const rows = (await c.query(
    `SELECT m.key, m.display_name, m.unit,
      (SELECT rate FROM rate_versions v WHERE v.key=m.key AND v.status='Active' ORDER BY version DESC LIMIT 1) AS rate,
      (SELECT to_char(created_at,'YYYY-MM-DD') FROM rate_versions v WHERE v.key=m.key AND v.status='Active' ORDER BY version DESC LIMIT 1) AS since
     FROM item_master m WHERE m.key = ANY($1)
     UNION ALL SELECT x.key, x.name, x.unit, NULL, NULL FROM misc_items x WHERE x.key = ANY($1)`,
    [keys],
  )).rows;
  return new Map(rows.map((r) => [r.key as string, { name: (r.display_name || r.key) as string, unit: r.unit as string, rate: r.rate == null ? null : num(r.rate), since: r.since as string | null }]));
}

/** The last approved purchase of each item, or the rate master rate until there is one. */
export async function lastRates(c: Db, keys: string[]) {
  const bought = new Map((await c.query(
    `SELECT DISTINCT ON (l.item_key) l.item_key, q.rate, l.unit, q.vendor, to_char(r.decided_at,'YYYY-MM-DD') AS on_date, r.number
     FROM purchase_request_lines l JOIN purchase_requests r ON r.id=l.request_id JOIN purchase_quotes q ON q.id=l.chosen_quote_id
     WHERE r.status IN ('approved','ordered','received') AND l.item_key = ANY($1)
     ORDER BY l.item_key, r.decided_at DESC`,
    [keys],
  )).rows.map((r) => [r.item_key as string, r]));
  const master = await rateMaster(c, keys);
  return (key: string): { rate: number; unit: string; source: string } | null => {
    const b = bought.get(key);
    if (b) return { rate: num(b.rate), unit: b.unit as string, source: `Last purchase ${b.number} · ${b.on_date} · ${b.vendor}` };
    const m = master.get(key);
    if (m && m.rate != null) return { rate: m.rate, unit: m.unit, source: `Rate master${m.since ? ` · ${m.since}` : ""}` };
    return null;
  };
}

/**
 * What the coming sites need against what Store has:
 * received POs (IPO issued, material not yet delivered) and upcoming POs (heads-ups without a PO),
 * stock on hand (latest count plus receipts after it), what is on order, and what is left to buy.
 */
export async function computeSupply(pool: Pool, c: Db) {
  await new SiteWorkflowRepository(pool).ensure(c);
  const pos = (await c.query(
    `SELECT o.id AS issuance_id, i.number AS ipo_number, i.snapshot->'customer'->>'name' AS customer, i.snapshot->>'siteName' AS site_name,
      i.snapshot->>'siteCode' AS site_code, i.snapshot->'input'->>'orderDate' AS po_date, s.region, w.stage,
      to_char(w.delivered_on,'YYYY-MM-DD') AS delivered_on, to_char(w.expected_delivery,'YYYY-MM-DD') AS expected_delivery
     FROM operations_boq_issuances o JOIN internal_purchase_orders i ON i.id=o.ipo_id
     LEFT JOIN site_workflow w ON w.issuance_id=o.id LEFT JOIN sites s ON s.id=w.site_id
     ORDER BY COALESCE(i.snapshot->'input'->>'orderDate', to_char(o.created_at,'YYYY-MM-DD')), o.created_at`,
  )).rows;
  const lines = (await c.query("SELECT issuance_id, item_key, unit, sum(quantity) AS qty FROM operations_stock_demand GROUP BY 1,2,3")).rows
    .filter((l) => !SERVICE_LINE.test(l.item_key) && String(l.unit).toUpperCase() !== "LS");
  const upA = (await c.query(
    `SELECT p.record_id, d.number, d.snapshot, p.updated_at, r.site_name, r.site_code, r.region, r.stage AS workflow_stage, cu.name AS customer
     FROM project_advance_planning p JOIN project_workflow_documents d ON d.id=p.document_id JOIN project_workflow_records r ON r.id=p.record_id
     LEFT JOIN customers cu ON cu.id=r.customer_id
     WHERE p.confirmed_issuance_id IS NULL AND r.stage NOT IN ('issued','declined')`,
  )).rows;
  const upB = (await c.query(
    `SELECT m.record_id, h.number, jsonb_build_object('items', site->'items', 'expectedDate', h.snapshot->>'expectedDate') AS snapshot, h.created_at AS updated_at,
      r.site_name, r.site_code, r.region, r.stage AS workflow_stage, cu.name AS customer
     FROM headsup_department_handoffs h JOIN headsup_advance_members m ON m.handoff_id=h.id JOIN project_workflow_records r ON r.id=m.record_id
     LEFT JOIN headsup_advance_final_links final ON final.record_id=m.record_id LEFT JOIN customers cu ON cu.id=r.customer_id
     JOIN LATERAL jsonb_array_elements(h.snapshot->'sites') site ON site->>'recordId'=m.record_id::text
     WHERE final.operations_id IS NULL AND r.stage NOT IN ('issued','declined') AND r.data->>'localPreviewArchived' IS DISTINCT FROM 'true'`,
  )).rows;
  const up = [...upB, ...upA];
  const stockRows = (await c.query(
    `WITH last_count AS (
       SELECT DISTINCT ON (item_key) item_key, quantity, unit, created_at FROM stock_on_hand_entries WHERE kind='count' ORDER BY item_key, created_at DESC)
     SELECT k.item_key, lc.quantity AS counted_qty, lc.unit AS count_unit, lc.created_at AS counted_at,
       (SELECT COALESCE(sum(r.quantity),0) FROM stock_on_hand_entries r WHERE r.item_key=k.item_key AND r.kind='receipt' AND (lc.created_at IS NULL OR r.created_at>lc.created_at)) AS received,
       (SELECT unit FROM stock_on_hand_entries r WHERE r.item_key=k.item_key ORDER BY created_at DESC LIMIT 1) AS last_unit
     FROM (SELECT DISTINCT item_key FROM stock_on_hand_entries) k LEFT JOIN last_count lc USING (item_key)`,
  )).rows;
  const stock = new Map(stockRows.map((r) => [r.item_key as string, {
    qty: num(r.counted_qty) + num(r.received), counted: r.counted_at != null,
    countedAt: r.counted_at ? new Date(r.counted_at).toISOString() : null, unit: (r.count_unit ?? r.last_unit) as string,
  }]));
  // Still due from vendors: approved and ordered quantities less what Store has already received against them.
  const order = new Map((await c.query(
    `SELECT l.item_key, sum(GREATEST(l.quantity - COALESCE(g.qty,0), 0)) AS qty
     FROM purchase_request_lines l JOIN purchase_requests r ON r.id=l.request_id
     LEFT JOIN (SELECT request_id, item_key, sum(quantity) AS qty FROM stock_on_hand_entries WHERE kind='receipt' AND request_id IS NOT NULL GROUP BY 1,2) g
       ON g.request_id=l.request_id AND g.item_key=l.item_key
     WHERE r.status IN ('approved','ordered') GROUP BY 1`,
  )).rows.map((r) => [r.item_key as string, num(r.qty)]));
  // Already on a draft or a request waiting for Abu Bakar: not counted twice.
  const requested = new Map((await c.query(
    `SELECT l.item_key, sum(l.quantity) AS qty FROM purchase_request_lines l JOIN purchase_requests r ON r.id=l.request_id
     WHERE r.status IN ('draft','pending_approval') GROUP BY 1`,
  )).rows.map((r) => [r.item_key as string, num(r.qty)]));

  const pending = new Set(pos.filter((p) => !p.delivered_on && p.stage !== "closed").map((p) => p.issuance_id as string));
  // Misc items BOQs from Design that Store has not sent yet: they count with the site's received PO, or as upcoming.
  const miscRows = (await c.query(
    `SELECT b.record_id, l.item_key, l.quantity AS qty, m.unit,
       (SELECT x.issuance_id FROM (
          SELECT operations_id AS issuance_id FROM project_workflow_issuances WHERE record_id=b.record_id
          UNION ALL SELECT confirmed_issuance_id FROM project_advance_planning WHERE record_id=b.record_id AND confirmed_issuance_id IS NOT NULL
          UNION ALL SELECT operations_id FROM headsup_advance_final_links WHERE record_id=b.record_id) x LIMIT 1) AS issuance_id
     FROM site_misc_boqs b JOIN site_misc_boq_lines l ON l.record_id=b.record_id JOIN misc_items m ON m.key=l.item_key
     WHERE b.sent_at IS NULL`,
  )).rows;
  const upcomingIds = new Set(up.map((u) => u.record_id as string));
  const need = new Map<string, { unit: string; received: number; upcoming: number }>();
  const add = (key: string, unit: string, field: "received" | "upcoming", qty: number) => {
    const row = need.get(key) ?? { unit, received: 0, upcoming: 0 };
    row[field] += qty;
    need.set(key, row);
  };
  for (const m of miscRows) {
    if (m.issuance_id && pending.has(m.issuance_id)) lines.push({ issuance_id: m.issuance_id, item_key: m.item_key, unit: m.unit, qty: m.qty });
    else if (!m.issuance_id && upcomingIds.has(m.record_id)) add(m.item_key, m.unit, "upcoming", num(m.qty));
  }
  for (const l of lines) if (pending.has(l.issuance_id)) add(l.item_key, l.unit, "received", num(l.qty));
  for (const u of up) for (const item of (u.snapshot?.items ?? []) as any[]) {
    const key = String(item.key ?? item.rateKey ?? "");
    if (!key || SERVICE_LINE.test(key) || String(item.unit ?? "").toUpperCase() === "LS") continue;
    add(key, String(item.unit ?? ""), "upcoming", num(item.qty ?? item.boqQty));
  }
  for (const key of stock.keys()) if (!need.has(key)) need.set(key, { unit: stock.get(key)!.unit, received: 0, upcoming: 0 });
  const master = await rateMaster(c, [...need.keys()]);

  // Inverters, batteries and BMS site by site, for Abu Bakar's watch.
  const watchNeeds: WatchNeed[] = [];
  const watched = (key: string) => !isMiscItem(key) && !boughtByBuyer(key, master.get(key)?.name ?? key);
  const site = (n: unknown, code: unknown) => `${n ?? "Site"}${code ? ` (${code})` : ""}`;
  const poBy = new Map(pos.map((p) => [p.issuance_id as string, p]));
  for (const l of lines) if (pending.has(l.issuance_id) && watched(l.item_key)) {
    const p = poBy.get(l.issuance_id);
    const date = p?.expected_delivery ?? p?.po_date ?? null;
    watchNeeds.push({ itemKey: l.item_key, label: site(p?.site_name, p?.site_code), kind: "received", date: date ? String(date).slice(0, 10) : null, qty: num(l.qty) });
  }
  for (const u of up) for (const item of (u.snapshot?.items ?? []) as any[]) {
    const key = String(item.key ?? item.rateKey ?? "");
    if (!key || SERVICE_LINE.test(key) || !watched(key)) continue;
    const date = u.snapshot?.expectedDate ?? null;
    watchNeeds.push({ itemKey: key, label: site(u.site_name, u.site_code), kind: "upcoming", date: date ? String(date).slice(0, 10) : null, qty: num(item.qty ?? item.boqQty) });
  }

  const inventory: InventoryRow[] = [...need.entries()].map(([key, x]) => {
    const s = stock.get(key);
    const have = s?.qty ?? 0, ord = order.get(key) ?? 0, req = requested.get(key) ?? 0;
    const name = master.get(key)?.name ?? key;
    return {
      itemKey: key, name, unit: x.unit || s?.unit || master.get(key)?.unit || "", inRateMaster: master.has(key), misc: isMiscItem(key), boughtByBuyer: boughtByBuyer(key, name),
      counted: Boolean(s?.counted), lastCountAt: s?.countedAt ?? null, stockUnit: s?.unit ?? null,
      inStock: fixed(have), receivedNeed: fixed(x.received), upcomingNeed: fixed(x.upcoming), onOrder: fixed(ord), requested: fixed(req),
      toBuy: fixed(Math.max(0, x.received + x.upcoming - have - ord - req)),
      shortForReceived: x.received > have + 1e-9, unitMismatch: Boolean(s?.unit && x.unit && !sameUnit(s.unit, x.unit)),
    };
  }).sort((a, b) => Number(b.boughtByBuyer) - Number(a.boughtByBuyer) || Number(b.toBuy) - Number(a.toBuy) || a.name.localeCompare(b.name));

  // Received POs in PO-date order take the stock first; whatever runs out marks that site short.
  const avail = new Map([...stock.entries()].map(([k, v]) => [k, v.qty]));
  const linesBy = new Map<string, any[]>();
  for (const l of lines) linesBy.set(l.issuance_id, [...(linesBy.get(l.issuance_id) ?? []), l]);
  const receivedPOs: ReceivedPo[] = pos.map((p): ReceivedPo => {
    const mine = linesBy.get(p.issuance_id) ?? [];
    const isPending = pending.has(p.issuance_id);
    const shortItems: string[] = [];
    if (isPending) for (const l of mine) {
      const left = avail.get(l.item_key) ?? 0;
      if (left + 1e-9 < num(l.qty)) shortItems.push(master.get(l.item_key)?.name ?? l.item_key);
      avail.set(l.item_key, left - num(l.qty));
    }
    return {
      issuanceId: p.issuance_id, ipoNumber: p.ipo_number, customer: p.customer ?? null, siteName: p.site_name ?? null, siteCode: p.site_code ?? null,
      region: p.region || null, poDate: p.po_date ?? null, stage: p.stage ?? null, deliveredOn: p.delivered_on, expectedDelivery: p.expected_delivery,
      items: mine.length, pending: isPending, shortItems, material: !isPending ? "delivered" : shortItems.length ? "short" : "ready",
    };
  }).reverse();

  const upcoming: UpcomingPo[] = up.map((u) => {
    const items = ((u.snapshot?.items ?? []) as any[]).filter((i) => !SERVICE_LINE.test(String(i.key ?? "")));
    const sum = (kind: string) => fixed(items.filter((i) => bigKind(String(i.key ?? "")) === kind).reduce((t, i) => t + num(i.qty ?? i.boqQty), 0));
    return {
      recordId: u.record_id, reference: u.number, customer: u.customer ?? null, siteName: u.site_name ?? null, siteCode: u.site_code ?? null,
      region: u.region || null, workflowStage: u.workflow_stage ?? null, expectedDate: u.snapshot?.expectedDate ?? null, items: items.length,
      bigItems: { panels: sum("panels"), batteries: sum("batteries"), inverters: sum("inverters") }, updatedAt: new Date(u.updated_at).toISOString(),
    };
  }).sort((a, b) => (a.expectedDate ?? "9999").localeCompare(b.expectedDate ?? "9999"));
  return { inventory, receivedPOs, upcoming, watchNeeds };
}
