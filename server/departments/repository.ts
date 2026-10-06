import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { transaction } from "../db/transaction.js";
import { HttpError } from "../http/errors.js";
export const departmentSchema = z.enum(["Inventory", "Accounts"]);
export type Department = z.infer<typeof departmentSchema>;
export const checkpointSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().min(0),
    stage: z.enum([
      "Preparing stock",
      "Ready for dispatch",
      "Dispatched",
      "Review in progress",
      "Awaiting documents",
    ]),
    notes: z.string().trim().min(1).max(2000),
    requestKey: z.uuid(),
  })
  .strict();
export class DepartmentRepository {
  constructor(private pool: Pool) {}
  async access(actor: string, department: Department) {
    const u = (
      await this.pool.query("SELECT active,role FROM users WHERE id=$1", [
        actor,
      ])
    ).rows[0];
    if (!u?.active) throw new HttpError(401, "Your access has ended.");
    if (!["Admin", "Management", department].includes(u.role))
      throw new HttpError(403, `${department} access required.`);
  }
  async portal(actor: string, department: Department) {
    await this.access(actor, department);
    const inventory = department === "Inventory",
      table = inventory ? "store_boq_issuances" : "internal_purchase_orders",
      key = inventory ? "store_issuance_id" : "ipo_id";
    const rows = (
      await this.pool.query(
        `SELECT s.id,s.number,s.snapshot,s.created_at,COALESCE(c.stage,$1) AS stage,COALESCE(c.version,0) AS version,COALESCE(c.created_at,s.created_at) AS stage_since,c.notes FROM ${table} s LEFT JOIN LATERAL(SELECT * FROM department_checkpoints WHERE ${key}=s.id ORDER BY version DESC LIMIT 1)c ON true ORDER BY s.created_at DESC LIMIT 500`,
        [inventory ? "Received BOQs" : "New IPOs"],
      )
    ).rows;
    return { department, records: rows };
  }
  async checkpoint(
    actor: string,
    department: Department,
    input: z.infer<typeof checkpointSchema>,
  ) {
    return transaction(this.pool, async (c) => {
      const u = (
        await c.query("SELECT active,role FROM users WHERE id=$1 FOR SHARE", [
          actor,
        ])
      ).rows[0];
      if (!u?.active) throw new HttpError(401, "Your access has ended.");
      if (!["Admin", "Management", department].includes(u.role))
        throw new HttpError(403, `${department} access required.`);
      const inventory = department === "Inventory",
        key = inventory ? "store_issuance_id" : "ipo_id",
        table = inventory ? "store_boq_issuances" : "internal_purchase_orders";
      const source = (
        await c.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [
          input.id,
        ])
      ).rows[0];
      if (!source) throw new HttpError(404, "Source document not found.");
      const replay = (
        await c.query(
          "SELECT * FROM department_checkpoints WHERE request_key=$1",
          [input.requestKey],
        )
      ).rows[0];
      if (replay) {
        if (
          replay.created_by !== actor ||
          replay.department !== department ||
          replay[key] !== input.id ||
          replay.version !== input.version + 1 ||
          replay.stage !== input.stage ||
          replay.notes !== input.notes
        )
          throw new HttpError(409, "Request key already used.");
        return replay;
      }
      const latest = (
        await c.query(
          `SELECT * FROM department_checkpoints WHERE ${key}=$1 ORDER BY version DESC LIMIT 1`,
          [input.id],
        )
      ).rows[0];
      if ((latest?.version ?? 0) !== input.version)
        throw new HttpError(
          409,
          "This document changed. Refresh before recording progress.",
        );
      if (inventory) {
        const next: Record<string, string> = {
          "Received BOQs": "Preparing stock",
          "Preparing stock": "Ready for dispatch",
          "Ready for dispatch": "Dispatched",
        };
        if (next[latest?.stage ?? "Received BOQs"] !== input.stage)
          throw new HttpError(
            409,
            "Complete the preceding Inventory stage first.",
          );
      } else if (
        !["Review in progress", "Awaiting documents"].includes(input.stage)
      )
        throw new HttpError(400, "Choose an Accounts review stage.");
      const row = (
        await c.query(
          "INSERT INTO department_checkpoints(id,department,store_issuance_id,ipo_id,stage,notes,version,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
          [
            randomUUID(),
            department,
            inventory ? input.id : null,
            inventory ? null : input.id,
            input.stage,
            input.notes,
            input.version + 1,
            input.requestKey,
            actor,
          ],
        )
      ).rows[0];
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `department.${department}.checkpoint:${row.id}`,
      ]);
      return row;
    });
  }
  async history(actor: string, department: Department, id: string) {
    await this.access(actor, department);
    const key = department === "Inventory" ? "store_issuance_id" : "ipo_id";
    return (
      await this.pool.query(
        `SELECT c.stage,c.notes,c.version,c.created_at,u.display_name AS recorded_by FROM department_checkpoints c JOIN users u ON u.id=c.created_by WHERE ${key}=$1 ORDER BY version DESC`,
        [id],
      )
    ).rows;
  }
}
