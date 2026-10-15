import type { Pool, PoolClient } from "pg";
import { HttpError } from "../http/errors.js";
import { transaction } from "../db/transaction.js";
import { audit, requireReader, requireSiteWriter, siteEvent } from "./access.js";

export const VENDOR_CATEGORIES = ["Structure", "Delivery", "Electrical labour", "Earthing", "Material supplier"] as const;
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

const shape = (v: any) => ({
  id: v.id, name: v.name, category: v.category, regions: v.regions ?? [], contactPerson: v.contact_person,
  phone: v.phone, email: v.email, notes: v.notes, status: v.status, updatedAt: v.updated_at,
});

export class VendorsRepository {
  constructor(private pool: Pool) {}

  async list(actor: string) {
    await requireReader(this.pool, actor);
    return (await this.pool.query("SELECT * FROM vendors ORDER BY category, lower(name)")).rows.map(shape);
  }

  async save(
    actor: string,
    input: { id?: string; name: string; category: VendorCategory; regions: string[]; contactPerson: string; phone: string; email: string; notes: string; status: "Active" | "Inactive" },
  ) {
    return transaction(this.pool, async (c) => {
      await requireSiteWriter(c, actor);
      const dup = (
        await c.query("SELECT id FROM vendors WHERE lower(btrim(name))=lower(btrim($1)) AND category=$2 AND id IS DISTINCT FROM $3", [
          input.name, input.category, input.id ?? null,
        ])
      ).rows[0];
      if (dup) throw new HttpError(409, "A vendor with this name already exists in that category.");
      let row;
      if (input.id) {
        row = (
          await c.query(
            `UPDATE vendors SET name=$2, category=$3, regions=$4, contact_person=$5, phone=$6, email=$7, notes=$8, status=$9, updated_by=$10, updated_at=now()
             WHERE id=$1 RETURNING *`,
            [input.id, input.name.trim(), input.category, input.regions, input.contactPerson, input.phone, input.email, input.notes, input.status, actor],
          )
        ).rows[0];
        if (!row) throw new HttpError(404, "Vendor not found.");
      } else {
        row = (
          await c.query(
            `INSERT INTO vendors(name,category,regions,contact_person,phone,email,notes,status,created_by,updated_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
            [input.name.trim(), input.category, input.regions, input.contactPerson, input.phone, input.email, input.notes, input.status, actor],
          )
        ).rows[0];
      }
      await audit(c, actor, `vendor.save:${row.id}`);
      return shape(row);
    });
  }

  /** Active assignments for one site, one per category. */
  async assignments(executionId: string, c: Pool | PoolClient = this.pool) {
    return (
      await c.query(
        `SELECT a.id, a.category, a.vendor_id, a.agreed_date, a.notes, a.created_at, v.name, v.phone, v.contact_person, u.display_name AS assigned_by
         FROM site_vendor_assignments a JOIN vendors v ON v.id=a.vendor_id JOIN users u ON u.id=a.created_by
         WHERE a.execution_id=$1 AND a.removed_at IS NULL ORDER BY a.category`,
        [executionId],
      )
    ).rows.map((a) => ({
      id: a.id, category: a.category, vendorId: a.vendor_id, vendorName: a.name, phone: a.phone, contactPerson: a.contact_person,
      agreedDate: a.agreed_date == null ? null : typeof a.agreed_date === "string" ? a.agreed_date : a.agreed_date.toISOString().slice(0, 10),
      notes: a.notes, assignedAt: a.created_at, assignedBy: a.assigned_by,
    }));
  }

  async assign(actor: string, executionId: string, input: { category: VendorCategory; vendorId: string; agreedDate: string | null; notes: string }) {
    return transaction(this.pool, async (c) => {
      await requireSiteWriter(c, actor);
      const site = (await c.query("SELECT id FROM site_execution_records WHERE id=$1 FOR UPDATE", [executionId])).rows[0];
      if (!site) throw new HttpError(404, "Site record not found.");
      const vendor = (await c.query("SELECT id, name, category, status FROM vendors WHERE id=$1", [input.vendorId])).rows[0];
      if (!vendor) throw new HttpError(404, "Vendor not found.");
      if (vendor.category !== input.category) throw new HttpError(400, `${vendor.name} is a ${vendor.category} vendor.`);
      if (vendor.status !== "Active") throw new HttpError(400, `${vendor.name} is inactive.`);
      const previous = await c.query(
        "UPDATE site_vendor_assignments SET removed_by=$3, removed_at=now() WHERE execution_id=$1 AND category=$2 AND removed_at IS NULL RETURNING vendor_id",
        [executionId, input.category, actor],
      );
      const a = (
        await c.query(
          "INSERT INTO site_vendor_assignments(execution_id,category,vendor_id,agreed_date,notes,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
          [executionId, input.category, input.vendorId, input.agreedDate, input.notes, actor],
        )
      ).rows[0];
      await siteEvent(c, executionId, "vendor_assigned", actor, {
        assignmentId: a.id, category: input.category, vendor: vendor.name, replaced: previous.rows[0]?.vendor_id ?? null, agreedDate: input.agreedDate,
      }, input.notes);
      await audit(c, actor, `vendor.assign:${executionId}:${input.category}:${input.vendorId}`);
      return a.id as string;
    });
  }

  async unassign(actor: string, executionId: string, assignmentId: string) {
    return transaction(this.pool, async (c) => {
      await requireSiteWriter(c, actor);
      const removed = await c.query(
        "UPDATE site_vendor_assignments SET removed_by=$3, removed_at=now() WHERE id=$2 AND execution_id=$1 AND removed_at IS NULL RETURNING category, vendor_id",
        [executionId, assignmentId, actor],
      );
      if (!removed.rowCount) throw new HttpError(404, "Active vendor assignment not found.");
      await siteEvent(c, executionId, "vendor_removed", actor, { assignmentId, category: removed.rows[0].category, vendorId: removed.rows[0].vendor_id });
      await audit(c, actor, `vendor.unassign:${executionId}:${assignmentId}`);
    });
  }
}
