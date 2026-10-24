import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { HttpError } from "../http/errors.js";

type Db = Pool | PoolClient;
type Who = { id?: string | null; email?: string | null };

/** "Chrome on Windows", "Safari on iPhone": enough to recognise a device without storing the full browser string. */
export function deviceOf(ua: string | undefined) {
  const s = ua ?? "";
  if (!s) return "";
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\/|Opera/.test(s) ? "Opera" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : /curl|node|axios|python/i.test(s) ? "Script" : "Browser";
  const os = /iPhone/.test(s) ? "iPhone" : /iPad/.test(s) ? "iPad" : /Android/.test(s) ? "Android" : /Windows/.test(s) ? "Windows" : /Mac OS X|Macintosh/.test(s) ? "macOS" : /Linux/.test(s) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}
export const clientOf = (req?: Pick<Request, "ip" | "get">) => ({ ip: req?.ip ?? "", device: deviceOf(req?.get("user-agent")) });

/** One immutable line in the security log (Moaz, 24 Oct 2026). Logging never blocks or undoes the work it records. */
export async function securityEvent(db: Db, kind: string, who: Who, detail = "", req?: Pick<Request, "ip" | "get" | "method" | "originalUrl">, status?: number) {
  const c = clientOf(req);
  try {
    await db.query(
      "INSERT INTO security_events(kind,user_id,email,detail,method,path,status,ip,device) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [kind, who.id ?? null, (who.email ?? "").slice(0, 200), detail.slice(0, 500), req?.method ?? "", (req?.originalUrl ?? "").split("?")[0].slice(0, 300), status ?? null, c.ip.slice(0, 64), c.device],
    );
  } catch (e) {
    console.error("Security log write failed", e instanceof Error ? e.message : e);
  }
}

/** Requests the page made on its own (timers), not because someone clicked or typed. */
export const isBackground = (req: Pick<Request, "get">) => req.get("X-PZ-Background") === "1";

// Views and exports of anything that shows prices or costs.
const PRICED = /^\/api\/(procurement\/requests|commercial|boqs|cni|orders|masters|director|ubl|accounts-workspace)(\/|$)/;
const APPROVAL = /approv|decide|decision/i;

/**
 * Records, after each response: views and exports of priced or costed pages, approvals and backup downloads.
 * Background refreshes are not recorded, so the log shows what people opened, not what the page polled.
 */
export function securityAudit(pool: Pool): RequestHandler {
  return (req, res, next) => {
    res.on("finish", () => {
      const s = req.authSession;
      if (!s || res.statusCode >= 400) return;
      const path = req.originalUrl.split("?")[0];
      const who = { id: s.user.id, email: s.user.email };
      const type = String(res.getHeader("Content-Type") ?? "");
      const action = typeof req.body?.action === "string" ? req.body.action : typeof req.body?.decision === "string" ? req.body.decision : "";
      let kind = "";
      if (path.startsWith("/api/backups")) kind = "backup";
      else if (req.method !== "GET" && (APPROVAL.test(path) || APPROVAL.test(action))) kind = "approval";
      else if (req.method === "GET" && PRICED.test(path) && !isBackground(req)) kind = /pdf|spreadsheet|excel|csv|zip/i.test(type) ? "export" : "view";
      if (kind) void securityEvent(pool, kind, who, action ? `action: ${action}` : "", req, res.statusCode);
    });
    next();
  };
}

const query = z.object({
  kind: z.string().trim().max(60).optional(),
  user: z.string().trim().max(200).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

/** Admin reads and filters the security log. */
export function securityEventsHttp(pool: Pool, requireSession: RequestHandler) {
  const r = Router();
  r.use(requireSession);
  r.get("/", async (req, res) => {
    if (req.authSession!.user.role !== "Admin") throw new HttpError(403, "Only Admin can read the security log.");
    const p = query.safeParse(req.query);
    if (!p.success) throw new HttpError(400, "Invalid filter.");
    const f = p.data;
    const rows = (await pool.query(
      `SELECT e.id, e.kind, e.email, u.display_name, e.detail, e.method, e.path, e.status, e.ip, e.device, e.created_at
       FROM security_events e LEFT JOIN users u ON u.id=e.user_id
       WHERE ($1::text IS NULL OR e.kind=$1)
         AND ($2::text IS NULL OR e.email ILIKE '%'||$2||'%' OR u.display_name ILIKE '%'||$2||'%')
         AND ($3::date IS NULL OR e.created_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Karachi'))
         AND ($4::date IS NULL OR e.created_at < (($4::date + 1)::timestamp AT TIME ZONE 'Asia/Karachi'))
         AND ($5::text IS NULL OR e.path ILIKE '%'||$5||'%' OR e.detail ILIKE '%'||$5||'%' OR e.ip ILIKE '%'||$5||'%')
       ORDER BY e.created_at DESC LIMIT $6`,
      [f.kind || null, f.user || null, f.from ?? null, f.to ?? null, f.q || null, f.limit],
    )).rows;
    const kinds = (await pool.query("SELECT DISTINCT kind FROM security_events ORDER BY kind")).rows.map((k) => k.kind as string);
    res.json({
      kinds,
      events: rows.map((e) => ({
        id: e.id as string, kind: e.kind as string, email: e.email as string, name: (e.display_name ?? null) as string | null, detail: e.detail as string,
        method: e.method as string, path: e.path as string, status: (e.status ?? null) as number | null, ip: e.ip as string, device: e.device as string, at: e.created_at as string,
      })),
    });
  });
  return r;
}

export const REAUTH_MINUTES = 5;
/** Money approvals need the password entered within the last 5 minutes, like backup downloads (Moaz, 24 Oct 2026). */
export function requireRecentPassword(req: Pick<Request, "authSession">) {
  const at = req.authSession?.reauthAt ? new Date(req.authSession.reauthAt).getTime() : 0;
  if (Date.now() - at > REAUTH_MINUTES * 60_000)
    throw new HttpError(403, `Enter your password to approve. It is asked again after ${REAUTH_MINUTES} minutes.`);
}
