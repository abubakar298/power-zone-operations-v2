import type { Pool } from "pg";
import { HttpError } from "../http/errors.js";
import { transaction } from "../db/transaction.js";
import { audit, requireReader, requireSiteWriter, siteEvent } from "./access.js";
import type { VendorCategory } from "./vendors.js";

export const PROCUREMENT_STATUSES = ["Not started", "Quoted", "Ordered", "Received", "Cancelled"] as const;
export type ProcurementStatus = (typeof PROCUREMENT_STATUSES)[number];

const day = (v: unknown) => (v == null ? null : v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : String(v));
const shape = (r: any) => ({
  id: r.id, executionId: r.execution_id, siteName: r.site_name ?? null, siteCode: r.site_code ?? null,
  itemKey: r.item_key, itemName: r.item_name ?? r.item_key, serviceCategory: r.service_category, description: r.description,
  quantity: r.quantity == null ? null : String(Number(r.quantity)), unit: r.unit, status: r.status,
  vendorId: r.vendor_id, vendorName: r.vendor_name ?? null, expectedDate: day(r.expected_date),
  amount: r.amount == null ? null : String(r.amount), notes: r.notes, createdAt: r.created_at, createdBy: r.created_by_name ?? null,
  updatedAt: r.updated_at,
});
const SELECT = `SELECT p.*, v.name AS vendor_name, m.display_name AS item_name, u.display_name AS created_by_name,
  i.snapshot->>'siteName' AS site_name, i.snapshot->>'siteCode' AS site_code
 FROM procurement_requests p LEFT JOIN vendors v ON v.id=p.vendor_id LEFT JOIN item_master m ON m.key=p.item_key
 JOIN users u ON u.id=p.created_by
 LEFT JOIN site_execution_records e ON e.id=p.execution_id LEFT JOIN internal_purchase_orders i ON i.id=e.ipo_id`;

export class ProcurementRepository {
  constructor(private pool: Pool) {}

  async list(actor: string, executionId?: string) {
    await requireReader(this.pool, actor);
    const rows = (
      await this.pool.query(`${SELECT} ${executionId ? "WHERE p.execution_id=$1" : ""} ORDER BY p.created_at DESC LIMIT 1000`, executionId ? [executionId] : [])
    ).rows;
    return rows.map(shape);
  }

  async create(
    actor: string,
    input: { executionId: string | null; itemKey: string | null; serviceCategory: VendorCategory | null; description: string; quantity: string | null; unit: string; vendorId: string | null; expectedDate: string | null; amount: string | null; notes: string },
  ) {
    return transaction(this.pool, async (c) => {
      await requireSiteWriter(c, actor);
      if (input.executionId) {
        const site = (await c.query("SELECT id FROM site_execution_records WHERE id=$1", [input.executionId])).rows[0];
        if (!site) throw new HttpError(404, "Site record not found.");
      }
      if (input.vendorId && !(await c.query("SELECT 1 FROM vendors WHERE id=$1", [input.vendorId])).rowCount)
        throw new HttpError(404, "Vendor not found.");
      const r = (
        await c.query(
          `INSERT INTO procurement_requests(execution_id,item_key,service_category,description,quantity,unit,vendor_id,expected_date,amount,notes,created_by,updated_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id`,
          [input.executionId, input.itemKey, input.serviceCategory, input.description, input.quantity, input.unit, input.vendorId, input.expectedDate, input.amount, input.notes, actor],
        )
      ).rows[0];
      await c.query("INSERT INTO procurement_request_events(request_id,from_status,to_status,changes,created_by) VALUES($1,NULL,'Not started',$2,$3)", [
        r.id, JSON.stringify({ created: input }), actor,
      ]);
      if (input.executionId)
        await siteEvent(c, input.executionId, "procurement", actor, { requestId: r.id, status: "Not started", description: input.description });
      await audit(c, actor, `procurement.create:${r.id}`);
      return r.id as string;
    });
  }

  async update(
    actor: string,
    id: string,
    input: { status?: ProcurementStatus; vendorId?: string | null; expectedDate?: string | null; amount?: string | null; notes?: string; note: string },
  ) {
    return transaction(this.pool, async (c) => {
      await requireSiteWriter(c, actor);
      const r = (await c.query("SELECT * FROM procurement_requests WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!r) throw new HttpError(404, "Procurement request not found.");
      if (["Received", "Cancelled"].includes(r.status) && input.status && input.status !== r.status)
        throw new HttpError(400, `A ${r.status.toLowerCase()} request cannot change status.`);
      if (input.vendorId && !(await c.query("SELECT 1 FROM vendors WHERE id=$1", [input.vendorId])).rowCount)
        throw new HttpError(404, "Vendor not found.");
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const set: string[] = [], values: unknown[] = [id];
      const consider = (field: string, column: string, to: unknown, from: unknown) => {
        if (to === undefined || String(to ?? "") === String(from ?? "")) return;
        values.push(to); set.push(`${column}=$${values.length}`); changes[field] = { from, to };
      };
      consider("status", "status", input.status, r.status);
      consider("vendorId", "vendor_id", input.vendorId, r.vendor_id);
      consider("expectedDate", "expected_date", input.expectedDate, day(r.expected_date));
      consider("amount", "amount", input.amount, r.amount == null ? null : String(r.amount));
      consider("notes", "notes", input.notes, r.notes);
      if (set.length) {
        values.push(actor);
        await c.query(`UPDATE procurement_requests SET ${set.join(", ")}, updated_by=$${values.length}, updated_at=now() WHERE id=$1`, values);
      }
      if (set.length || input.note) {
        await c.query("INSERT INTO procurement_request_events(request_id,from_status,to_status,changes,note,created_by) VALUES($1,$2,$3,$4,$5,$6)", [
          id, r.status, input.status ?? r.status, JSON.stringify(changes), input.note, actor,
        ]);
        if (r.execution_id)
          await siteEvent(c, r.execution_id, "procurement", actor, { requestId: id, status: input.status ?? r.status, changed: Object.keys(changes) }, input.note);
        await audit(c, actor, `procurement.update:${id}:${Object.keys(changes).join(",") || "note"}`);
      }
    });
  }
}
