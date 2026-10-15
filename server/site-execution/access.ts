import type { Pool, PoolClient } from "pg";
import { HttpError } from "../http/errors.js";

export const SITE_WRITERS = new Set(["Admin", "Management", "Operations"]);
/** Store keeps the stock counts; Operations and Management may correct them. */
export const STOCK_WRITERS = new Set(["Admin", "Management", "Operations", "Inventory"]);
export const SITE_READERS = new Set(["Admin", "Management", "Operations", "Inventory", "Accounts", "Coordinator"]);

export async function actorRole(c: Pool | PoolClient, actor: string) {
  const u = (await c.query("SELECT role FROM users WHERE id=$1 AND active", [actor])).rows[0];
  if (!u) throw new HttpError(403, "Your account is not active.");
  return u.role as string;
}
export async function requireReader(c: Pool | PoolClient, actor: string) {
  const role = await actorRole(c, actor);
  if (!SITE_READERS.has(role)) throw new HttpError(403, "Your department does not have access to site operations.");
  return role;
}
export async function requireSiteWriter(c: Pool | PoolClient, actor: string) {
  const role = await actorRole(c, actor);
  if (!SITE_WRITERS.has(role)) throw new HttpError(403, "Only Operations or Management can change a site record.");
  return role;
}
export async function requireStockWriter(c: Pool | PoolClient, actor: string) {
  const role = await actorRole(c, actor);
  if (!STOCK_WRITERS.has(role)) throw new HttpError(403, "Only Store, Operations or Management can change stock.");
  return role;
}
export async function siteEvent(
  c: PoolClient,
  executionId: string,
  kind: string,
  actor: string,
  changes: unknown = {},
  note = "",
) {
  await c.query(
    "INSERT INTO site_execution_events(execution_id,kind,changes,note,created_by) VALUES($1,$2,$3,$4,$5)",
    [executionId, kind, JSON.stringify(changes), note, actor],
  );
}
export async function audit(c: PoolClient, actor: string, action: string) {
  await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [actor, action]);
}
