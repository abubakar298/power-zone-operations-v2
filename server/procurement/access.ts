import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import { HttpError } from "../http/errors.js";
import { transaction } from "../db/transaction.js";
import { clientOf, securityEvent } from "../security/events.js";

type Db = Pool | PoolClient;
/** The buyer works in the Operations login's Procurement shell; the approver is Admin or Management. */
const ROLE_FOR: Record<"buyer" | "approver", string[]> = { buyer: ["Operations"], approver: ["Admin", "Management"] };

/**
 * Procurement access managed by Admin (Moaz, 24 Oct 2026): grant or remove buyer and approver by exact email.
 * Migration 101's name-based grants stay as they were; every change from now on leaves an immutable record.
 */
export class ProcurementAccessRepository {
  constructor(private pool: Pool) {}

  private async admin(actor: string, c: Db) {
    const u = (await c.query("SELECT role FROM users WHERE id=$1 AND active", [actor])).rows[0];
    if (u?.role !== "Admin") throw new HttpError(403, "Only Admin can manage Procurement access.");
  }

  async list(actor: string, c: Db = this.pool) {
    await this.admin(actor, c);
    const grants = (await c.query(
      `SELECT a.capability, a.granted_reason, a.created_at, u.email, u.display_name, u.role, u.active
       FROM procurement_access a JOIN users u ON u.id=a.user_id ORDER BY a.capability, lower(u.display_name)`,
    )).rows.map((g) => ({ capability: g.capability as "buyer" | "approver", reason: g.granted_reason as string, since: g.created_at as string, email: g.email as string, name: g.display_name as string, role: g.role as string, active: g.active as boolean }));
    const events = (await c.query(
      `SELECT e.capability, e.action, e.reason, e.ip, e.device, e.created_at, t.email, t.display_name AS name, a.display_name AS actor
       FROM procurement_access_events e JOIN users t ON t.id=e.user_id JOIN users a ON a.id=e.actor ORDER BY e.created_at DESC LIMIT 200`,
    )).rows.map((e) => ({ capability: e.capability as string, action: e.action as string, reason: e.reason as string, ip: e.ip as string, device: e.device as string, at: e.created_at as string, email: e.email as string, name: e.name as string, actor: e.actor as string }));
    const people = (await c.query("SELECT email, display_name, role FROM users WHERE active AND role IN ('Operations','Admin','Management') ORDER BY lower(display_name)"))
      .rows.map((p) => ({ email: p.email as string, name: p.display_name as string, role: p.role as string }));
    return { grants, events, people, rules: ROLE_FOR };
  }

  async change(actor: string, input: { email: string; capability: "buyer" | "approver"; action: "grant" | "remove"; reason: string }, req?: Pick<Request, "ip" | "get" | "method" | "originalUrl">) {
    return transaction(this.pool, async (c) => {
      await this.admin(actor, c);
      const user = (await c.query("SELECT id, email, role, active FROM users WHERE email=$1", [input.email])).rows[0];
      if (!user?.active) throw new HttpError(404, "No active user has exactly that email.");
      const has = Boolean((await c.query("SELECT 1 FROM procurement_access WHERE user_id=$1 AND capability=$2 FOR UPDATE", [user.id, input.capability])).rowCount);
      if (input.action === "grant") {
        if (!ROLE_FOR[input.capability].includes(user.role))
          throw new HttpError(422, input.capability === "buyer" ? "The buyer must be an Operations login." : "The approver must be an Admin or Management login.");
        if (has) throw new HttpError(409, `${user.email} is already ${input.capability === "buyer" ? "a buyer" : "an approver"}.`);
        await c.query("INSERT INTO procurement_access(user_id, capability, granted_reason) VALUES($1,$2,$3)", [user.id, input.capability, input.reason]);
      } else {
        if (!has) throw new HttpError(404, `${user.email} is not ${input.capability === "buyer" ? "a buyer" : "an approver"}.`);
        await c.query("DELETE FROM procurement_access WHERE user_id=$1 AND capability=$2", [user.id, input.capability]);
      }
      const where = clientOf(req);
      await c.query(
        "INSERT INTO procurement_access_events(user_id, capability, action, reason, actor, ip, device) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [user.id, input.capability, input.action, input.reason, actor, where.ip.slice(0, 64), where.device],
      );
      await securityEvent(c, `procurement-access.${input.action}`, { id: actor }, `${input.capability} for ${user.email}: ${input.reason}`, req, 200);
      return this.list(actor, c);
    });
  }
}
