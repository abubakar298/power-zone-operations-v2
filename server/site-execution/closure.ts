import type { Pool } from "pg";
import { HttpError } from "../http/errors.js";
import { transaction } from "../db/transaction.js";
import { audit, requireReader, requireSiteWriter, siteEvent } from "./access.js";

/** BOQ lines treated as cables for the variance report. */
export const CABLE_LINE = "cable";
const n = (v: unknown) => (v == null ? 0 : Number(v));
const fixed = (v: number) => v.toFixed(6).replace(/\.?0+$/, "").replace(/^-0$/, "0");

const SITE_SQL = `SELECT e.id, e.issuance_id, e.stage, i.snapshot->>'siteName' AS site_name, i.snapshot->>'siteCode' AS site_code,
  i.snapshot->'customer'->>'name' AS customer, s.region
 FROM site_execution_records e JOIN internal_purchase_orders i ON i.id=e.ipo_id LEFT JOIN sites s ON s.id=e.site_id`;

function cableRow(l: any) {
  const boq = n(l.boq_qty), used = l.used_qty == null ? null : n(l.used_qty), returned = n(l.returned_qty);
  const variance = used == null ? null : used - boq;
  return {
    itemKey: l.item_key,
    name: l.display_name ?? l.item_key,
    unit: l.unit,
    boqQty: fixed(boq),
    issuedQty: l.issued_qty == null ? null : fixed(n(l.issued_qty)),
    usedQty: used == null ? null : fixed(used),
    returnedQty: fixed(returned),
    variance: variance == null ? null : fixed(variance),
    direction: variance == null ? "Not entered" : variance > 1e-9 ? "Extra used: invoice the customer" : variance < -1e-9 ? "Less used: refund if charged" : "Matches BOQ",
    flagged: variance != null && Math.abs(variance) > 1e-9,
    note: l.note ?? "",
    updatedAt: l.updated_at ?? null,
    updatedBy: l.updated_by_name ?? null,
  };
}

export class ClosureRepository {
  constructor(private pool: Pool) {}

  /** Cable lines of one site: BOQ quantity, quantity sent to Store, actual used and returned. */
  async cables(actor: string, executionId: string) {
    await requireReader(this.pool, actor);
    const site = (await this.pool.query("SELECT issuance_id FROM site_execution_records WHERE id=$1", [executionId])).rows[0];
    if (!site) throw new HttpError(404, "Site record not found.");
    const rows = (
      await this.pool.query(
        `SELECT d.item_key, d.unit, SUM(d.quantity) AS boq_qty, MIN(m.display_name) AS display_name,
          (SELECT SUM((it->>'qty')::numeric) FROM store_boq_issuances s CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.snapshot->'items','[]'::jsonb)) it
            WHERE s.issuance_id=d.issuance_id AND it->>'key'=d.item_key) AS issued_qty,
          u.used_qty, u.returned_qty, u.note, u.updated_at, ub.display_name AS updated_by_name
         FROM operations_stock_demand d LEFT JOIN item_master m ON m.key=d.item_key
         LEFT JOIN site_cable_usage u ON u.execution_id=$2 AND u.item_key=d.item_key
         LEFT JOIN users ub ON ub.id=u.updated_by
         WHERE d.issuance_id=$1 AND (d.item_key ~* $3 OR COALESCE(d.specification,'') ~* $3)
         GROUP BY d.issuance_id, d.item_key, d.unit, u.used_qty, u.returned_qty, u.note, u.updated_at, ub.display_name
         ORDER BY d.item_key`,
        [site.issuance_id, executionId, CABLE_LINE],
      )
    ).rows;
    return rows.map(cableRow);
  }

  async setCableUsage(actor: string, executionId: string, input: { itemKey: string; usedQty: string; returnedQty: string; note: string }) {
    return transaction(this.pool, async (c) => {
      await requireSiteWriter(c, actor);
      const site = (await c.query("SELECT issuance_id FROM site_execution_records WHERE id=$1 FOR UPDATE", [executionId])).rows[0];
      if (!site) throw new HttpError(404, "Site record not found.");
      const line = (
        await c.query("SELECT 1 FROM operations_stock_demand WHERE issuance_id=$1 AND item_key=$2 AND (item_key ~* $3 OR COALESCE(specification,'') ~* $3)", [
          site.issuance_id, input.itemKey, CABLE_LINE,
        ])
      ).rowCount;
      if (!line) throw new HttpError(400, "That item is not a cable line on this site's BOQ.");
      const before = (await c.query("SELECT used_qty, returned_qty FROM site_cable_usage WHERE execution_id=$1 AND item_key=$2", [executionId, input.itemKey])).rows[0];
      await c.query(
        `INSERT INTO site_cable_usage(execution_id,item_key,used_qty,returned_qty,note,updated_by) VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT (execution_id,item_key) DO UPDATE SET used_qty=EXCLUDED.used_qty, returned_qty=EXCLUDED.returned_qty, note=EXCLUDED.note, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [executionId, input.itemKey, input.usedQty, input.returnedQty, input.note, actor],
      );
      await siteEvent(c, executionId, "cable_usage", actor, {
        itemKey: input.itemKey, usedQty: input.usedQty, returnedQty: input.returnedQty,
        previous: before ? { usedQty: fixed(n(before.used_qty)), returnedQty: fixed(n(before.returned_qty)) } : null,
      }, input.note);
      await audit(c, actor, `site-execution.cables:${executionId}:${input.itemKey}`);
    });
  }

  async additionalItems(actor: string, executionId: string) {
    await requireReader(this.pool, actor);
    return (
      await this.pool.query(
        `SELECT a.*, u.display_name AS created_by_name, m.display_name AS item_name, r.display_name AS removed_by_name
         FROM site_additional_items a JOIN users u ON u.id=a.created_by LEFT JOIN item_master m ON m.key=a.item_key LEFT JOIN users r ON r.id=a.removed_by
         WHERE a.execution_id=$1 ORDER BY a.created_at DESC`,
        [executionId],
      )
    ).rows.map((a) => ({
      id: a.id, itemKey: a.item_key, itemName: a.item_name ?? null, description: a.description, quantity: fixed(n(a.quantity)), unit: a.unit,
      reason: a.reason, createdAt: a.created_at, createdBy: a.created_by_name, removedAt: a.removed_at, removedBy: a.removed_by_name ?? null, removalReason: a.removal_reason,
    }));
  }

  async addAdditionalItem(actor: string, executionId: string, input: { itemKey: string | null; description: string; quantity: string; unit: string; reason: string }) {
    return transaction(this.pool, async (c) => {
      await requireSiteWriter(c, actor);
      const site = (await c.query("SELECT id FROM site_execution_records WHERE id=$1 FOR UPDATE", [executionId])).rows[0];
      if (!site) throw new HttpError(404, "Site record not found.");
      const a = (
        await c.query(
          "INSERT INTO site_additional_items(execution_id,item_key,description,quantity,unit,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
          [executionId, input.itemKey, input.description, input.quantity, input.unit, input.reason, actor],
        )
      ).rows[0];
      await siteEvent(c, executionId, "additional_item", actor, { additionalItemId: a.id, description: input.description, quantity: input.quantity, unit: input.unit }, input.reason);
      await audit(c, actor, `site-execution.additional:${executionId}:${a.id}`);
      return a.id as string;
    });
  }

  async removeAdditionalItem(actor: string, executionId: string, itemId: string, input: { reason: string }) {
    return transaction(this.pool, async (c) => {
      await requireSiteWriter(c, actor);
      const removed = await c.query(
        "UPDATE site_additional_items SET removed_by=$3, removed_at=now(), removal_reason=$4 WHERE id=$2 AND execution_id=$1 AND removed_at IS NULL RETURNING description",
        [executionId, itemId, actor, input.reason],
      );
      if (!removed.rowCount) throw new HttpError(404, "Additional item not found.");
      await siteEvent(c, executionId, "additional_item_removed", actor, { additionalItemId: itemId, description: removed.rows[0].description }, input.reason);
      await audit(c, actor, `site-execution.additional-removed:${executionId}:${itemId}`);
    });
  }

  /** Every site with cable usage entered, one row per cable line, flagged on any variance. */
  async cableVarianceReport(actor: string) {
    await requireReader(this.pool, actor);
    const rows = (
      await this.pool.query(
        `WITH sites AS (${SITE_SQL})
         SELECT st.id AS execution_id, st.site_name, st.site_code, st.customer, st.region, st.stage,
          d.item_key, d.unit, SUM(d.quantity) AS boq_qty, MIN(m.display_name) AS display_name,
          u.used_qty, u.returned_qty, u.note, u.updated_at, ub.display_name AS updated_by_name, NULL::numeric AS issued_qty
         FROM sites st JOIN operations_stock_demand d ON d.issuance_id=st.issuance_id
         LEFT JOIN item_master m ON m.key=d.item_key
         JOIN site_cable_usage u ON u.execution_id=st.id AND u.item_key=d.item_key
         LEFT JOIN users ub ON ub.id=u.updated_by
         WHERE d.item_key ~* $1 OR COALESCE(d.specification,'') ~* $1
         GROUP BY st.id, st.site_name, st.site_code, st.customer, st.region, st.stage, d.item_key, d.unit, u.used_qty, u.returned_qty, u.note, u.updated_at, ub.display_name
         ORDER BY st.site_name, d.item_key`,
        [CABLE_LINE],
      )
    ).rows;
    const lines = rows.map((r) => ({
      executionId: r.execution_id, siteName: r.site_name, siteCode: r.site_code, customer: r.customer, region: r.region || null, stage: r.stage,
      ...cableRow(r),
    }));
    const flaggedSites = new Set(lines.filter((l) => l.flagged).map((l) => l.executionId)).size;
    return { lines, flaggedSites, sitesReported: new Set(lines.map((l) => l.executionId)).size };
  }

  /** Additional items across all sites, for Accounts. */
  async additionalItemsReport(actor: string) {
    await requireReader(this.pool, actor);
    const rows = (
      await this.pool.query(
        `WITH sites AS (${SITE_SQL})
         SELECT st.id AS execution_id, st.site_name, st.site_code, st.customer, st.region, st.stage,
          a.id, a.item_key, m.display_name AS item_name, a.description, a.quantity, a.unit, a.reason, a.created_at, u.display_name AS created_by
         FROM site_additional_items a JOIN sites st ON st.id=a.execution_id JOIN users u ON u.id=a.created_by LEFT JOIN item_master m ON m.key=a.item_key
         WHERE a.removed_at IS NULL ORDER BY a.created_at DESC`,
      )
    ).rows;
    return rows.map((r) => ({
      executionId: r.execution_id, siteName: r.site_name, siteCode: r.site_code, customer: r.customer, region: r.region || null, stage: r.stage,
      id: r.id, itemKey: r.item_key, itemName: r.item_name ?? null, description: r.description, quantity: fixed(n(r.quantity)), unit: r.unit,
      reason: r.reason, createdAt: r.created_at, createdBy: r.created_by,
    }));
  }
}
