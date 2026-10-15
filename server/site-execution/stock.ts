import type { Pool } from "pg";
import { HttpError } from "../http/errors.js";
import { transaction } from "../db/transaction.js";
import { audit, requireReader, requireSiteWriter, requireStockWriter, siteEvent } from "./access.js";

/** Stages during which a site's BOQ quantities still count as "required" from stock. */
export const PLANNING_STAGES = ["ipo_received", "material_planning", "procurement", "delivery_scheduled"];
/** BOQ lines that are vendor work or services, never items held in Store. */
export const SERVICE_LINE = "(labour|labor|delivery|logistics|structure|synchroni[sz]ation|internet service|installation)";
const n = (v: unknown) => (v == null ? 0 : Number(v));
const fixed = (v: number) => v.toFixed(6).replace(/\.?0+$/, "");

export class StockRepository {
  constructor(private pool: Pool) {}

  /** Per item: required (issued BOQs in planning stages + provisional heads-up BOQs), existing count,
   * reserved, available, shortage and quantities on order. No ledger: existing is the latest count. */
  async overview(actor: string) {
    await requireReader(this.pool, actor);
    const [issued, headsUp, counts, reserved, onOrder] = await Promise.all([
      this.pool.query(
        `SELECT d.item_key, MIN(d.unit) AS unit, MIN(d.specification) AS specification, SUM(d.quantity) AS qty, COUNT(DISTINCT d.issuance_id)::int AS sites
         FROM operations_stock_demand d JOIN site_execution_records e ON e.issuance_id=d.issuance_id
         WHERE e.stage = ANY($1) AND d.item_key !~* $2 AND COALESCE(d.specification,'') !~* $2 GROUP BY d.item_key`,
        [PLANNING_STAGES, SERVICE_LINE],
      ),
      this.pool.query(
        `SELECT i->>'key' AS item_key, MIN(i->>'unit') AS unit, MIN(i->>'description') AS description,
          SUM((i->>'qty')::numeric) AS qty, COUNT(DISTINCT a.record_id)::int AS sites
         FROM project_advance_planning a JOIN project_workflow_documents d ON d.id=a.document_id
         CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.snapshot->'items','[]'::jsonb)) i
         WHERE a.mode='Provisional' AND a.confirmed_issuance_id IS NULL AND (i->>'key') IS NOT NULL
          AND (i->>'key') !~* $1 AND COALESCE(i->>'description','') !~* $1
         GROUP BY 1`,
        [SERVICE_LINE],
      ),
      this.pool.query(
        `SELECT DISTINCT ON (item_key) item_key, quantity, counted_at, note FROM stock_counts ORDER BY item_key, counted_at DESC`,
      ),
      this.pool.query(
        `SELECT item_key, SUM(quantity) AS qty, COUNT(DISTINCT execution_id)::int AS sites FROM stock_reservations WHERE released_at IS NULL GROUP BY 1`,
      ),
      this.pool.query(
        `SELECT item_key, SUM(COALESCE(quantity,0)) AS qty FROM procurement_requests WHERE item_key IS NOT NULL AND status IN ('Quoted','Ordered') GROUP BY 1`,
      ),
    ]);
    const keys = new Set<string>();
    for (const r of [...issued.rows, ...headsUp.rows, ...counts.rows, ...reserved.rows, ...onOrder.rows]) keys.add(r.item_key);
    const master = keys.size
      ? (await this.pool.query("SELECT key, display_name, unit FROM item_master WHERE key = ANY($1)", [[...keys]])).rows
      : [];
    const byKey = <T extends { item_key: string }>(rows: T[]) => new Map(rows.map((r) => [r.item_key, r]));
    const iss = byKey(issued.rows), hu = byKey(headsUp.rows), cnt = byKey(counts.rows), res = byKey(reserved.rows), ord = byKey(onOrder.rows);
    const names = new Map(master.map((m) => [m.key, m]));
    const items = [...keys].map((key) => {
      const requiredIssued = n(iss.get(key)?.qty), requiredHeadsUp = n(hu.get(key)?.qty);
      const required = requiredIssued + requiredHeadsUp;
      const existing = cnt.has(key) ? n(cnt.get(key)!.quantity) : null;
      const reservedQty = n(res.get(key)?.qty);
      const available = existing == null ? null : Math.max(existing - reservedQty, 0);
      const shortage = Math.max(required - (existing ?? 0), 0);
      return {
        itemKey: key,
        name: names.get(key)?.display_name ?? hu.get(key)?.description ?? key,
        unit: iss.get(key)?.unit ?? hu.get(key)?.unit ?? names.get(key)?.unit ?? "",
        requiredIssued: fixed(requiredIssued),
        requiredHeadsUp: fixed(requiredHeadsUp),
        required: fixed(required),
        sitesIssued: iss.get(key)?.sites ?? 0,
        sitesHeadsUp: hu.get(key)?.sites ?? 0,
        existing: existing == null ? null : fixed(existing),
        countedAt: cnt.get(key)?.counted_at ?? null,
        reserved: fixed(reservedQty),
        reservedSites: res.get(key)?.sites ?? 0,
        available: available == null ? null : fixed(available),
        shortage: fixed(shortage),
        onOrder: fixed(n(ord.get(key)?.qty)),
        counted: existing != null,
      };
    });
    items.sort((a, b) => Number(b.shortage) - Number(a.shortage) || a.name.localeCompare(b.name));
    const reservations = (
      await this.pool.query(
        `SELECT r.id, r.execution_id, r.item_key, r.quantity, r.note, r.reserved_at, u.display_name AS reserved_by,
          i.snapshot->>'siteName' AS site_name, i.snapshot->>'siteCode' AS site_code, e.stage
         FROM stock_reservations r JOIN site_execution_records e ON e.id=r.execution_id
         JOIN internal_purchase_orders i ON i.id=e.ipo_id JOIN users u ON u.id=r.reserved_by
         WHERE r.released_at IS NULL ORDER BY r.reserved_at DESC LIMIT 500`,
      )
    ).rows.map((r) => ({
      id: r.id, executionId: r.execution_id, itemKey: r.item_key, name: names.get(r.item_key)?.display_name ?? r.item_key,
      quantity: fixed(n(r.quantity)), note: r.note, reservedAt: r.reserved_at, reservedBy: r.reserved_by,
      siteName: r.site_name, siteCode: r.site_code, stage: r.stage,
    }));
    return { items, reservations };
  }

  /** One site's BOQ lines with what is reserved for it and what is available in stock. */
  async siteMaterials(actor: string, executionId: string) {
    await requireReader(this.pool, actor);
    const site = (await this.pool.query("SELECT issuance_id FROM site_execution_records WHERE id=$1", [executionId])).rows[0];
    if (!site) throw new HttpError(404, "Site record not found.");
    const lines = (
      await this.pool.query(
        `SELECT d.line_number, d.item_key, d.brand, d.specification, d.quantity, d.unit, m.display_name,
          COALESCE((SELECT SUM(quantity) FROM stock_reservations r WHERE r.execution_id=$2 AND r.item_key=d.item_key AND r.released_at IS NULL),0) AS reserved_here,
          (SELECT quantity FROM stock_counts c WHERE c.item_key=d.item_key ORDER BY counted_at DESC LIMIT 1) AS existing,
          COALESCE((SELECT SUM(quantity) FROM stock_reservations r WHERE r.item_key=d.item_key AND r.released_at IS NULL),0) AS reserved_all
         FROM operations_stock_demand d LEFT JOIN item_master m ON m.key=d.item_key
         WHERE d.issuance_id=$1 AND d.item_key !~* $3 AND COALESCE(d.specification,'') !~* $3 ORDER BY d.line_number`,
        [site.issuance_id, executionId, SERVICE_LINE],
      )
    ).rows.map((l) => ({
      lineNumber: l.line_number, itemKey: l.item_key, name: l.display_name ?? l.item_key, brand: l.brand,
      specification: l.specification ?? "", unit: l.unit, boqQty: fixed(n(l.quantity)), reserved: fixed(n(l.reserved_here)),
      existing: l.existing == null ? null : fixed(n(l.existing)),
      available: l.existing == null ? null : fixed(Math.max(n(l.existing) - n(l.reserved_all), 0)),
      outstanding: fixed(Math.max(n(l.quantity) - n(l.reserved_here), 0)),
    }));
    const reservations = (
      await this.pool.query(
        `SELECT r.id, r.item_key, r.quantity, r.note, r.reserved_at, r.released_at, r.release_reason, u.display_name AS reserved_by
         FROM stock_reservations r JOIN users u ON u.id=r.reserved_by WHERE r.execution_id=$1 ORDER BY r.reserved_at DESC`,
        [executionId],
      )
    ).rows.map((r) => ({
      id: r.id, itemKey: r.item_key, quantity: fixed(n(r.quantity)), note: r.note, reservedAt: r.reserved_at,
      reservedBy: r.reserved_by, releasedAt: r.released_at, releaseReason: r.release_reason,
    }));
    return { lines, reservations };
  }

  async setCount(actor: string, input: { itemKey: string; quantity: string; note: string }) {
    return transaction(this.pool, async (c) => {
      await requireStockWriter(c, actor);
      await c.query("INSERT INTO stock_counts(item_key,quantity,note,counted_by) VALUES($1,$2,$3,$4)", [
        input.itemKey, input.quantity, input.note, actor,
      ]);
      await audit(c, actor, `stock.count:${input.itemKey}:${input.quantity}`);
    });
  }

  async reserve(actor: string, executionId: string, input: { itemKey: string; quantity: string; note: string }) {
    return transaction(this.pool, async (c) => {
      await requireSiteWriter(c, actor);
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`stock:${input.itemKey}`]);
      const site = (await c.query("SELECT id FROM site_execution_records WHERE id=$1 FOR UPDATE", [executionId])).rows[0];
      if (!site) throw new HttpError(404, "Site record not found.");
      const existing = (await c.query("SELECT quantity FROM stock_counts WHERE item_key=$1 ORDER BY counted_at DESC LIMIT 1", [input.itemKey])).rows[0];
      if (!existing) throw new HttpError(400, "Store has not entered a stock count for this item yet.");
      const reserved = n((await c.query("SELECT SUM(quantity) AS q FROM stock_reservations WHERE item_key=$1 AND released_at IS NULL", [input.itemKey])).rows[0].q);
      const available = n(existing.quantity) - reserved;
      if (Number(input.quantity) > available + 1e-9)
        throw new HttpError(400, `Only ${fixed(Math.max(available, 0))} available to reserve for this item.`);
      const r = (
        await c.query("INSERT INTO stock_reservations(execution_id,item_key,quantity,note,reserved_by) VALUES($1,$2,$3,$4,$5) RETURNING id", [
          executionId, input.itemKey, input.quantity, input.note, actor,
        ])
      ).rows[0];
      await siteEvent(c, executionId, "reservation", actor, { reservationId: r.id, itemKey: input.itemKey, quantity: input.quantity }, input.note);
      await audit(c, actor, `stock.reserve:${executionId}:${input.itemKey}:${input.quantity}`);
      return r.id as string;
    });
  }

  async release(actor: string, executionId: string, reservationId: string, input: { reason: string }) {
    return transaction(this.pool, async (c) => {
      await requireSiteWriter(c, actor);
      const updated = await c.query(
        "UPDATE stock_reservations SET released_by=$3, released_at=now(), release_reason=$4 WHERE id=$2 AND execution_id=$1 AND released_at IS NULL RETURNING item_key, quantity",
        [executionId, reservationId, actor, input.reason],
      );
      if (!updated.rowCount) throw new HttpError(404, "Open reservation not found.");
      await siteEvent(c, executionId, "reservation_released", actor, { reservationId, itemKey: updated.rows[0].item_key, quantity: fixed(n(updated.rows[0].quantity)) }, input.reason);
      await audit(c, actor, `stock.release:${executionId}:${reservationId}`);
    });
  }
}
