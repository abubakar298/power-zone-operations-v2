import type { Pool, PoolClient } from "pg";
import { HttpError } from "../http/errors.js";
import { transaction } from "../db/transaction.js";
import { boughtByBuyer, computeSupply, fixed, num, type InventoryRow, type WatchNeed } from "./supply.js";

type Db = Pool | PoolClient;
const LEVELS = ["ok", "on_order", "plan", "urgent"] as const;
export type WatchLevel = (typeof LEVELS)[number];
export const DEFAULT_LEAD_DAYS = 30;
/** The morning summary goes out from this hour, Pakistan time. */
export const SUMMARY_HOUR = 9;
const NEW_NUMBER = "'PR-' || to_char(now(),'YY') || '-' || lpad(nextval('purchase_request_number')::text,3,'0')";

/** Today's date in Pakistan, as YYYY-MM-DD. */
export const karachiDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(d);
const karachiHour = (d = new Date()) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", hourCycle: "h23" }).format(d));
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export interface WatchRow {
  itemKey: string; name: string; unit: string; inStock: string; receivedNeed: string; upcomingNeed: string; onOrder: string;
  minStock: string; leadDays: number; short: string; urgentShort: string; level: WatchLevel;
  firstShort: { label: string; kind: "received" | "upcoming"; date: string | null } | null;
  orderBy: string | null; late: boolean;
  sites: { label: string; kind: "received" | "upcoming"; date: string | null; quantity: string }[];
}

/**
 * One item's position: what the received and upcoming POs need against stock and orders, which site runs out first,
 * and the date to order by (that site's date less the lead time).
 */
export function assess(row: InventoryRow, needs: WatchNeed[], setting: { leadDays: number; minStock: number }, today: string): WatchRow {
  const stock = num(row.inStock), onOrder = num(row.onOrder), received = num(row.receivedNeed), upcoming = num(row.upcomingNeed);
  const short = Math.max(0, received + upcoming + setting.minStock - stock - onOrder);
  const urgentShort = Math.max(0, received + setting.minStock - stock - onOrder);
  const level: WatchLevel = urgentShort > 1e-9 ? "urgent" : short > 1e-9 ? "plan" : received + setting.minStock > stock + 1e-9 ? "on_order" : "ok";
  // Sites with a customer PO take stock first, then upcoming ones, each by date.
  const sorted = [...needs].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "received" ? -1 : 1) || (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  let left = stock + onOrder - setting.minStock;
  let firstShort: WatchRow["firstShort"] = null;
  for (const n of sorted) {
    left -= n.qty;
    if (left < -1e-9 && !firstShort) firstShort = { label: n.label, kind: n.kind, date: n.date };
  }
  let orderBy: string | null = null, late = false;
  if (level === "urgent") orderBy = today;
  else if (level === "plan") {
    orderBy = firstShort?.date ? addDays(firstShort.date, -setting.leadDays) : today;
    if (orderBy < today) { orderBy = today; late = true; }
  }
  return {
    itemKey: row.itemKey, name: row.name, unit: row.unit, inStock: row.inStock, receivedNeed: row.receivedNeed, upcomingNeed: row.upcomingNeed, onOrder: row.onOrder,
    minStock: fixed(setting.minStock), leadDays: setting.leadDays, short: fixed(short), urgentShort: fixed(urgentShort), level, firstShort, orderBy, late,
    sites: sorted.map((n) => ({ label: n.label, kind: n.kind, date: n.date, quantity: fixed(n.qty) })),
  };
}

/** One line for an alert: "BMS HV: 9 No. short · 1 needed now for sites with a PO · order now". */
export function alertLine(r: WatchRow) {
  const when = r.level === "urgent" || r.orderBy === null ? "order now" : r.late ? `order now (should have been ordered by ${shortDay(r.orderBy)})` : `order by ${shortDay(r.orderBy)}`;
  return `${r.name}: ${r.short} ${r.unit} short${num(r.urgentShort) > 0 ? ` · ${r.urgentShort} needed now for sites with a customer PO` : ""}${r.firstShort ? ` · first short: ${r.firstShort.label}` : ""} · ${when}`;
}

/**
 * Inverter, battery and BMS watch (Moaz, 24 Oct 2026). Hamza does not buy these items, so Abu Bakar is told as soon
 * as the coming sites need more than Store has and has on order, with the date to order by. He records his orders
 * here; Store receives them like any other order. Alerts reach his bell and, when email is on, his inbox.
 */
export class StockWatchRepository {
  constructor(private pool: Pool) {}

  private async who(actor: string, c: Db = this.pool) {
    const u = (await c.query("SELECT role FROM users WHERE id=$1 AND active", [actor])).rows[0];
    if (!u) throw new HttpError(403, "Your account is not active.");
    const approver = Boolean((await c.query("SELECT 1 FROM procurement_access WHERE user_id=$1 AND capability='approver'", [actor])).rowCount);
    return { role: u.role as string, approver };
  }
  private async viewer(actor: string, c: Db = this.pool) {
    const w = await this.who(actor, c);
    if (!w.approver && !["Admin", "Management"].includes(w.role)) throw new HttpError(403, "The inverter and battery watch is for Abu Bakar.");
    return w;
  }
  private async approverOnly(actor: string, c: Db) {
    const w = await this.who(actor, c);
    if (!w.approver) throw new HttpError(403, "Only Abu Bakar can change the inverter and battery watch.");
    return w;
  }

  /** Every inverter, battery and BMS item in the rate master that the coming sites need or Store holds. */
  async rows(c: Db = this.pool, today = karachiDay()) {
    const supply = await computeSupply(this.pool, c);
    const settings = new Map((await c.query("SELECT item_key, lead_days, min_stock FROM stock_watch_settings")).rows
      .map((s) => [s.item_key as string, { leadDays: s.lead_days as number, minStock: num(s.min_stock) }]));
    return supply.inventory
      .filter((i) => !boughtByBuyer(i.itemKey, i.name) && i.inRateMaster && !i.misc)
      .map((i) => assess(i, supply.watchNeeds.filter((n) => n.itemKey === i.itemKey), settings.get(i.itemKey) ?? { leadDays: DEFAULT_LEAD_DAYS, minStock: 0 }, today))
      .sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) || (a.orderBy ?? "9999").localeCompare(b.orderBy ?? "9999") || a.name.localeCompare(b.name));
  }

  private async orders(c: Db, today: string) {
    const rows = (await c.query(
      `SELECT r.id, r.number, r.vendor, r.order_reference, r.expected_on, r.status, r.ordered_at, r.received_at, u.display_name AS ordered_by
       FROM purchase_requests r LEFT JOIN users u ON u.id=r.ordered_by
       WHERE r.kind='direct' AND (r.status='ordered' OR r.received_at > now() - interval '30 days') ORDER BY r.status='received', r.expected_on NULLS LAST, r.ordered_at DESC`,
    )).rows;
    const lines = rows.length ? (await c.query(
      `SELECT l.request_id, l.item_key, m.display_name, l.quantity, l.unit,
         (SELECT COALESCE(sum(e.quantity),0) FROM stock_on_hand_entries e WHERE e.kind='receipt' AND e.request_id=l.request_id AND e.item_key=l.item_key) AS received
       FROM purchase_request_lines l LEFT JOIN item_master m ON m.key=l.item_key WHERE l.request_id = ANY($1) ORDER BY l.item_key`,
      [rows.map((r) => r.id)],
    )).rows : [];
    return rows.map((r) => {
      const expectedOn = r.expected_on ? karachiDay(new Date(r.expected_on)) : null;
      return {
        id: r.id as string, number: r.number as string, vendor: r.vendor as string, orderReference: r.order_reference as string, expectedOn,
        status: r.status as string, orderedAt: r.ordered_at as string, orderedBy: (r.ordered_by ?? null) as string | null, receivedAt: (r.received_at ?? null) as string | null,
        overdue: r.status === "ordered" && Boolean(expectedOn && expectedOn < today),
        lines: lines.filter((l) => l.request_id === r.id).map((l) => ({
          itemKey: l.item_key as string, name: (l.display_name || l.item_key) as string, quantity: fixed(num(l.quantity)), received: fixed(num(l.received)), unit: l.unit as string,
        })),
      };
    });
  }

  async view(actor: string) {
    const w = await this.viewer(actor);
    if (w.approver) await this.check();
    const today = karachiDay();
    return { today, rows: await this.rows(this.pool, today), orders: await this.orders(this.pool, today), defaults: { leadDays: DEFAULT_LEAD_DAYS, summaryHour: SUMMARY_HOUR }, can: { change: w.approver } };
  }

  async saveSetting(actor: string, itemKey: string, input: { leadDays: number; minStock: string }) {
    await transaction(this.pool, async (c) => {
      await this.approverOnly(actor, c);
      const item = (await c.query("SELECT key, display_name FROM item_master WHERE key=$1", [itemKey])).rows[0];
      if (!item || boughtByBuyer(item.key, item.display_name ?? "")) throw new HttpError(400, "Only inverters, batteries and BMS are watched here.");
      await c.query(
        `INSERT INTO stock_watch_settings(item_key, lead_days, min_stock, updated_by) VALUES($1,$2,$3,$4)
         ON CONFLICT (item_key) DO UPDATE SET lead_days=$2, min_stock=$3, updated_by=$4, updated_at=now()`,
        [itemKey, input.leadDays, input.minStock, actor],
      );
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [actor, `stock-watch.setting:${itemKey}`]);
    });
    return this.view(actor);
  }

  /** Abu Bakar's own order for inverters, batteries or BMS. It goes straight to Store's "Material to receive". */
  async createOrder(actor: string, input: { vendor: string; orderReference: string; expectedOn: string | null; note: string; lines: { itemKey: string; quantity: string; rate: string | null }[] }) {
    await transaction(this.pool, async (c) => {
      await this.approverOnly(actor, c);
      const seen = new Set<string>();
      for (const l of input.lines) {
        if (seen.has(l.itemKey)) throw new HttpError(400, "An item appears twice on the order.");
        seen.add(l.itemKey);
        const item = (await c.query("SELECT key, display_name FROM item_master WHERE key=$1", [l.itemKey])).rows[0];
        if (!item) throw new HttpError(400, "Choose items from the rate master.");
        if (boughtByBuyer(item.key, item.display_name ?? "")) throw new HttpError(422, `${item.display_name || item.key} is bought by Procurement; Hamza orders it.`);
      }
      const units = new Map((await c.query("SELECT key, unit FROM item_master WHERE key = ANY($1)", [[...seen]])).rows.map((r) => [r.key as string, r.unit as string]));
      const r = (await c.query(
        `INSERT INTO purchase_requests(number, title, purpose, needed_by, status, kind, vendor, expected_on, created_by)
         VALUES(${NEW_NUMBER}, $1, $2, $3, 'draft', 'direct', $4, $3, $5) RETURNING id, status`,
        [`Inverters, batteries and BMS · ${input.vendor}`, input.note, input.expectedOn, input.vendor, actor],
      )).rows[0];
      for (const l of input.lines) {
        const line = (await c.query(
          "INSERT INTO purchase_request_lines(request_id, item_key, quantity, unit) VALUES($1,$2,$3,$4) RETURNING id",
          [r.id, l.itemKey, l.quantity, units.get(l.itemKey) ?? ""],
        )).rows[0];
        if (l.rate != null) {
          const q = (await c.query("INSERT INTO purchase_quotes(line_id, vendor, rate, created_by) VALUES($1,$2,$3,$4) RETURNING id", [line.id, input.vendor, l.rate, actor])).rows[0];
          await c.query("UPDATE purchase_request_lines SET chosen_quote_id=$2 WHERE id=$1", [line.id, q.id]);
        }
      }
      await c.query(
        `UPDATE purchase_requests SET status='ordered', submitted_at=now(), decided_by=$2, decided_at=now(), ordered_by=$2, ordered_at=now(), order_reference=$3, updated_at=now() WHERE id=$1`,
        [r.id, actor, input.orderReference],
      );
      for (const [kind, from, to, note] of [["created", null, "draft", "Direct order for inverters, batteries or BMS"], ["ordered", "draft", "ordered", input.orderReference]] as const)
        await c.query("INSERT INTO purchase_request_events(request_id,kind,from_status,to_status,note,created_by) VALUES($1,$2,$3,$4,$5,$6)", [r.id, kind, from, to, note, actor]);
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [actor, `stock-watch.order:${r.id}`]);
    });
    return this.view(actor);
  }

  private async alert(c: PoolClient, userId: string, kind: "shortage" | "summary" | "overdue", reference: string, details: string[], orderId: string | null = null) {
    const a = (await c.query(
      `INSERT INTO stock_watch_alerts(kind, user_id, reference, details, order_id, day) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT DO NOTHING RETURNING id, created_at`,
      [kind, userId, reference.slice(0, 500), JSON.stringify(details), orderId, karachiDay()],
    )).rows[0];
    if (!a) return false;
    await c.query(
      `INSERT INTO notifications(id,user_id,source_key,entity_key,kind,title,reference,actor_id,target,actionable,created_at)
       VALUES(gen_random_uuid(),$1,$2,$3,'Stock shortage','Inverter, battery & BMS shortage',$4,NULL,$5,false,$6) ON CONFLICT DO NOTHING`,
      [userId, `stock-watch:${a.id}`, `stock-watch:${kind}`, reference.slice(0, 500), JSON.stringify({ target: "stock-watch" }), a.created_at],
    );
    return true;
  }

  /**
   * Compare every watched item with the last check and alert Abu Bakar when a shortage appears or grows; once a day,
   * send a summary while anything is short; and flag his orders that are past their expected date.
   */
  async check(now = new Date()) {
    return transaction(this.pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(742019077)");
      const approvers = (await c.query(
        "SELECT u.id FROM procurement_access a JOIN users u ON u.id=a.user_id AND u.active WHERE a.capability='approver'",
      )).rows.map((r) => r.id as string);
      const today = karachiDay(now);
      const rows = await this.rows(c, today);
      const state = new Map((await c.query("SELECT item_key, level, short FROM stock_watch_state")).rows.map((s) => [s.item_key as string, s]));
      const worse: WatchRow[] = [];
      for (const r of rows) {
        const prev = state.get(r.itemKey);
        const alerting = r.level === "plan" || r.level === "urgent";
        if (alerting && (!prev || LEVELS.indexOf(r.level) > LEVELS.indexOf(prev.level) || num(r.short) > num(prev.short) + 1e-9)) worse.push(r);
        if (!prev || prev.level !== r.level || Math.abs(num(prev.short) - num(r.short)) > 1e-9)
          await c.query(
            `INSERT INTO stock_watch_state(item_key, level, short) VALUES($1,$2,$3)
             ON CONFLICT (item_key) DO UPDATE SET level=$2, short=$3, changed_at=now()`,
            [r.itemKey, r.level, r.short],
          );
      }
      let sent = 0;
      for (const userId of approvers) {
        if (worse.length) {
          const reference = worse.length === 1 ? alertLine(worse[0]) : `${worse.length} items short: ${worse.map((r) => r.name).join(", ")}`;
          if (await this.alert(c, userId, "shortage", reference, worse.map(alertLine))) sent++;
        }
        const open = rows.filter((r) => r.level === "plan" || r.level === "urgent");
        if (open.length && karachiHour(now) >= SUMMARY_HOUR) {
          const urgent = open.filter((r) => r.level === "urgent").length;
          const reference = `Morning summary: ${open.length} item${open.length === 1 ? "" : "s"} short${urgent ? `, ${urgent} needed now for sites with a customer PO` : ""}`;
          if (await this.alert(c, userId, "summary", reference, open.map(alertLine))) sent++;
        }
        for (const o of (await this.orders(c, today)).filter((x) => x.overdue)) {
          const reference = `${o.number} from ${o.vendor || "the vendor"} was expected ${shortDay(o.expectedOn!)} and has not fully arrived`;
          if (await this.alert(c, userId, "overdue", reference, o.lines.map((l) => `${l.name}: ${l.received} of ${l.quantity} ${l.unit} received`), o.id)) sent++;
        }
      }
      return { alerts: sent, short: rows.filter((r) => r.level === "plan" || r.level === "urgent").length };
    });
  }
}

/** Checks every 15 minutes, so new POs, heads-ups, counts and deliveries are picked up without anyone opening the page. */
export function startStockWatch(pool: Pool, everyMs = 15 * 60_000) {
  const watch = new StockWatchRepository(pool);
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    void watch.check().catch((e) => console.error("Stock watch check failed", e instanceof Error ? e.message : e)).finally(() => { running = false; });
  };
  const first = setTimeout(run, 30_000);
  const timer = setInterval(run, everyMs);
  first.unref?.(); timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}
