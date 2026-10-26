import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import { createHash } from "node:crypto";
import { HttpError } from "../http/errors.js";
import { transaction } from "../db/transaction.js";
import { clientOf, securityEvent } from "../security/events.js";
import { assessQc, dueAt, kindLabel, QC_KINDS, requiredKinds, type QcKind, type QcSite } from "./rules.js";

type Db = Pool | PoolClient;
export const QC_ROLE = "Quality Control";
/** Store and Accounts logins can be made viewers; Admin and Management always view. */
const VIEWER_ROLES = ["Inventory", "Accounts"];
const MIME = { "image/jpeg": [0xff, 0xd8, 0xff], "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d] } as const;
type Mime = keyof typeof MIME;

const SITES_SQL = `SELECT w.id, w.stage, w.site_type, w.scope, to_char(w.delivered_on,'YYYY-MM-DD') AS delivered_on,
   to_char(w.bess_delivered_on,'YYYY-MM-DD') AS bess_delivered_on, w.closed_at,
   i.number AS ipo_number, i.snapshot->'customer'->>'name' AS customer, COALESCE(NULLIF(i.snapshot->>'siteName',''), s.name) AS site_name,
   i.snapshot->>'siteCode' AS site_code, s.region
 FROM site_workflow w JOIN internal_purchase_orders i ON i.id=w.ipo_id LEFT JOIN sites s ON s.id=w.site_id`;
const site = (r: any): QcSite => ({ siteType: r.site_type ?? null, scope: r.scope ?? null, deliveredOn: r.delivered_on ?? null, bessDeliveredOn: r.bess_delivered_on ?? null });
const label = (r: any) => `${r.site_name ?? "Site"}${r.site_code ? ` (${r.site_code})` : ""}`;

/**
 * Quality Control documents (Moaz, 26 Oct 2026). The QC in-charge attaches each site's delivery challans, delivery and
 * installation pictures, reports and acknowledgement, and submits them; Shaigan and the Accounts people Admin names
 * are told and can view them, read only. Submitted files are permanent.
 */
export class QualityRepository {
  constructor(private pool: Pool) {}

  async who(actor: string, c: Db = this.pool) {
    const u = (await c.query("SELECT role, display_name FROM users WHERE id=$1 AND active", [actor])).rows[0];
    if (!u) throw new HttpError(403, "Your account is not active.");
    const viewer = Boolean((await c.query("SELECT 1 FROM qc_access WHERE user_id=$1 AND capability='viewer'", [actor])).rowCount);
    const upload = u.role === QC_ROLE || u.role === "Admin";
    return { role: u.role as string, name: u.display_name as string, upload, view: upload || viewer || u.role === "Management", manage: u.role === "Admin", kpi: upload || u.role === "Management" };
  }
  private async viewer(actor: string, c: Db = this.pool) {
    const w = await this.who(actor, c);
    if (!w.view) throw new HttpError(403, "Site documents are not part of your workspace.");
    return w;
  }
  private async uploader(actor: string, c: Db) {
    const w = await this.who(actor, c);
    if (!w.upload) throw new HttpError(403, "Only Quality Control can attach and submit site documents.");
    return w;
  }
  private async done(c: Db, ids: string[]) {
    const m = new Map<string, Set<QcKind>>();
    if (!ids.length) return m;
    for (const r of (await c.query("SELECT DISTINCT workflow_id, kind FROM qc_submissions WHERE workflow_id = ANY($1)", [ids])).rows)
      m.set(r.workflow_id, (m.get(r.workflow_id) ?? new Set()).add(r.kind));
    return m;
  }

  /** Every site from delivery on, open or closed in the last 30 days, with its checklist and whether it is red. */
  async sites(actor: string, now = new Date()) {
    const w = await this.viewer(actor);
    const rows = (await this.pool.query(
      `${SITES_SQL} WHERE (w.stage IN ('delivery','installation','commissioning','handover','doc_dispatch') OR w.delivered_on IS NOT NULL OR w.bess_delivered_on IS NOT NULL OR w.closed_at > now() - interval '30 days')
         AND (w.closed_at IS NULL OR w.closed_at > now() - interval '30 days')`,
    )).rows;
    const done = await this.done(this.pool, rows.map((r) => r.id));
    const drafts = w.upload && rows.length ? new Map((await this.pool.query(
      "SELECT workflow_id, count(*)::int AS n FROM qc_files WHERE submission_id IS NULL AND workflow_id = ANY($1) GROUP BY 1", [rows.map((r) => r.id)],
    )).rows.map((d) => [d.workflow_id as string, d.n as number])) : new Map<string, number>();
    const list = rows.map((r) => {
      const qc = assessQc(site(r), done.get(r.id) ?? new Set(), now);
      const next = qc.items.filter((i) => !i.done && i.dueAt).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))[0] ?? null;
      return {
        id: r.id as string, site: label(r), siteName: r.site_name as string | null, siteCode: (r.site_code ?? null) as string | null, customer: (r.customer ?? null) as string | null,
        region: (r.region || null) as string | null, ipoNumber: r.ipo_number as string, siteType: (r.site_type ?? null) as string | null, scope: (r.scope ?? null) as string | null,
        stage: r.stage as string, deliveredOn: (r.delivered_on ?? null) as string | null, bessDeliveredOn: (r.bess_delivered_on ?? null) as string | null, closed: Boolean(r.closed_at),
        qc, nextDue: next ? { label: next.label, dueAt: next.dueAt, overdue: next.overdue } : null, drafts: drafts.get(r.id) ?? 0,
      };
    }).sort((a, b) => Number(b.qc.red) - Number(a.qc.red) || b.qc.overdue.length - a.qc.overdue.length || (a.nextDue?.dueAt ?? "9").localeCompare(b.nextDue?.dueAt ?? "9") || a.site.localeCompare(b.site));
    return { sites: list, can: { upload: w.upload, manage: w.manage, kpi: w.kpi } };
  }

  async site(actor: string, id: string, c: Db = this.pool, now = new Date()) {
    const w = await this.viewer(actor, c);
    const r = (await c.query(`${SITES_SQL} WHERE w.id=$1`, [id])).rows[0];
    if (!r) throw new HttpError(404, "Site not found.");
    const qc = assessQc(site(r), (await this.done(c, [id])).get(id) ?? new Set(), now);
    const subs = (await c.query(
      "SELECT q.*, u.display_name AS by FROM qc_submissions q JOIN users u ON u.id=q.submitted_by WHERE q.workflow_id=$1 ORDER BY q.submitted_at DESC", [id],
    )).rows;
    const files = (await c.query(
      `SELECT f.id, f.kind, f.submission_id, f.filename, f.mime, f.size, f.original_size, f.uploaded_at, u.display_name AS by
       FROM qc_files f JOIN users u ON u.id=f.uploaded_by WHERE f.workflow_id=$1 AND ($2 OR f.submission_id IS NOT NULL) ORDER BY f.uploaded_at`,
      [id, w.upload],
    )).rows.map((f) => ({ id: f.id as string, kind: f.kind as QcKind, submissionId: (f.submission_id ?? null) as string | null, filename: f.filename as string, mime: f.mime as string, size: f.size as number, originalSize: f.original_size as number, uploadedAt: f.uploaded_at as string, by: f.by as string }));
    return {
      id: r.id as string, site: label(r), customer: (r.customer ?? null) as string | null, region: (r.region || null) as string | null, ipoNumber: r.ipo_number as string,
      siteType: (r.site_type ?? null) as string | null, scope: (r.scope ?? null) as string | null, stage: r.stage as string, closed: Boolean(r.closed_at),
      deliveredOn: (r.delivered_on ?? null) as string | null, bessDeliveredOn: (r.bess_delivered_on ?? null) as string | null, qc,
      documents: qc.items.map((i) => ({
        ...i,
        submissions: subs.filter((s) => s.kind === i.kind).map((s) => ({
          id: s.id as string, at: s.submitted_at as string, by: s.by as string, note: s.note as string, onTime: (s.on_time ?? null) as boolean | null, dueAt: (s.due_at ?? null) as string | null,
          files: files.filter((f) => f.submissionId === s.id),
        })),
        drafts: files.filter((f) => f.kind === i.kind && !f.submissionId),
      })),
      can: { upload: w.upload && !r.closed_at },
    };
  }

  async attach(actor: string, id: string, input: { kind: QcKind; filename: string; mime: Mime; base64: string; originalSize: number }, req?: Pick<Request, "ip" | "get" | "method" | "originalUrl">) {
    return transaction(this.pool, async (c) => {
      await this.uploader(actor, c);
      const r = (await c.query(`${SITES_SQL} WHERE w.id=$1 FOR UPDATE OF w`, [id])).rows[0];
      if (!r) throw new HttpError(404, "Site not found.");
      if (r.closed_at) throw new HttpError(422, "This site is closed.");
      if (!requiredKinds(site(r)).includes(input.kind)) throw new HttpError(422, `${kindLabel(input.kind)} is not needed for this site.`);
      const bytes = Buffer.from(input.base64, "base64");
      const magic = MIME[input.mime];
      if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new HttpError(413, "Each file must be 8 MB or smaller.");
      if (!magic.every((b, i) => bytes[i] === b)) throw new HttpError(400, "The file is not a real JPEG, PNG or PDF.");
      await c.query(
        "INSERT INTO qc_files(workflow_id, kind, filename, mime, size, original_size, sha256, content, uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [id, input.kind, input.filename, input.mime, bytes.length, Math.max(input.originalSize, bytes.length), createHash("sha256").update(bytes).digest("hex"), bytes, actor],
      );
      await securityEvent(c, "qc.attached", { id: actor }, `${label(r)} · ${kindLabel(input.kind)} · ${input.filename}`, req, 200);
      return this.site(actor, id, c);
    });
  }

  async removeDraft(actor: string, fileId: string) {
    return transaction(this.pool, async (c) => {
      await this.uploader(actor, c);
      const f = (await c.query("SELECT workflow_id, submission_id FROM qc_files WHERE id=$1 FOR UPDATE", [fileId])).rows[0];
      if (!f) throw new HttpError(404, "File not found.");
      if (f.submission_id) throw new HttpError(422, "Submitted documents cannot be removed.");
      await c.query("DELETE FROM qc_files WHERE id=$1", [fileId]);
      return this.site(actor, f.workflow_id, c);
    });
  }

  /** Submit the attached files for one document; viewers are told; the time is judged against the deadline. */
  async submit(actor: string, id: string, input: { kind: QcKind; note: string }, now = new Date()) {
    return transaction(this.pool, async (c) => {
      const w = await this.uploader(actor, c);
      const r = (await c.query(`${SITES_SQL} WHERE w.id=$1 FOR UPDATE OF w`, [id])).rows[0];
      if (!r) throw new HttpError(404, "Site not found.");
      if (r.closed_at) throw new HttpError(422, "This site is closed.");
      const drafts = (await c.query("SELECT id FROM qc_files WHERE workflow_id=$1 AND kind=$2 AND submission_id IS NULL", [id, input.kind])).rows;
      if (!drafts.length) throw new HttpError(422, "Attach the pictures or documents first.");
      const due = dueAt(input.kind, site(r));
      const sub = (await c.query(
        "INSERT INTO qc_submissions(workflow_id, kind, note, due_at, on_time, submitted_by, submitted_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [id, input.kind, input.note, due, due ? now <= due : null, actor, now],
      )).rows[0];
      await c.query("UPDATE qc_files SET submission_id=$1 WHERE workflow_id=$2 AND kind=$3 AND submission_id IS NULL", [sub.id, id, input.kind]);
      const reference = `${label(r)} · ${kindLabel(input.kind, site(r))}: ${drafts.length} file${drafts.length === 1 ? "" : "s"} submitted by ${w.name}${due && now > due ? " (late)" : ""}${input.note ? ` · ${input.note}` : ""}`.slice(0, 500);
      const viewers = (await c.query(
        "SELECT a.user_id FROM qc_access a JOIN users u ON u.id=a.user_id AND u.active WHERE a.capability='viewer' AND a.user_id<>$1", [actor],
      )).rows;
      for (const v of viewers) {
        const n = (await c.query(
          "INSERT INTO qc_notices(user_id, workflow_id, submission_id, reference) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id, created_at",
          [v.user_id, id, sub.id, reference],
        )).rows[0];
        if (n)
          await c.query(
            `INSERT INTO notifications(id,user_id,source_key,entity_key,kind,title,reference,actor_id,target,actionable,created_at)
             VALUES(gen_random_uuid(),$1,$2,$3,'QC documents submitted','Site documents submitted by Quality Control',$4,NULL,$5,false,$6) ON CONFLICT DO NOTHING`,
            [v.user_id, `qc-notice:${n.id}`, `qc-site:${id}`, reference, JSON.stringify({ target: "qc-documents", workflowId: id }), n.created_at],
          );
      }
      return this.site(actor, id, c, now);
    });
  }

  /** One file, for viewing or download. Viewers see submitted files only. */
  async file(actor: string, fileId: string) {
    const w = await this.viewer(actor);
    const f = (await this.pool.query(
      `SELECT f.*, i.snapshot->'customer'->>'name' AS customer, COALESCE(NULLIF(i.snapshot->>'siteName',''), s.name) AS site_name, i.snapshot->>'siteCode' AS site_code
       FROM qc_files f JOIN site_workflow w ON w.id=f.workflow_id JOIN internal_purchase_orders i ON i.id=w.ipo_id LEFT JOIN sites s ON s.id=w.site_id WHERE f.id=$1`,
      [fileId],
    )).rows[0];
    if (!f || (!f.submission_id && !w.upload)) throw new HttpError(404, "File not found.");
    return { filename: f.filename as string, mime: f.mime as string, content: f.content as Buffer, customer: (f.customer ?? "") as string, site: (f.site_name ?? "") as string, siteCode: (f.site_code ?? "") as string, kind: f.kind as QcKind };
  }

  /**
   * KPI for a month: delivery papers in the first three working hours of the next working day, BESS installation papers
   * within three days. On time, late, and still missing past the deadline.
   */
  async kpi(actor: string, month: string, now = new Date()) {
    const w = await this.who(actor);
    if (!w.kpi) throw new HttpError(403, "The Quality Control KPI is for Quality Control and Management.");
    const start = new Date(`${month}-01T00:00:00+05:00`), end = new Date(start); end.setMonth(end.getMonth() + 1);
    const subs = (await this.pool.query(
      `SELECT DISTINCT ON (q.workflow_id, q.kind) q.workflow_id, q.kind, q.due_at, q.submitted_at, q.on_time FROM qc_submissions q
       WHERE q.due_at >= $1 AND q.due_at < $2 ORDER BY q.workflow_id, q.kind, q.submitted_at`,
      [start, end],
    )).rows;
    const rows = (await this.pool.query(SITES_SQL)).rows;
    const names = new Map(rows.map((r) => [r.id as string, label(r)]));
    const done = await this.done(this.pool, rows.map((r) => r.id));
    const items: { site: string; document: string; dueAt: string; submittedAt: string | null; status: "on_time" | "late" | "missing" }[] = subs.map((s) => ({
      site: names.get(s.workflow_id) ?? "Site", document: kindLabel(s.kind, site(rows.find((r) => r.id === s.workflow_id) ?? {})),
      dueAt: new Date(s.due_at).toISOString(), submittedAt: new Date(s.submitted_at).toISOString(), status: s.on_time ? "on_time" : "late",
    }));
    for (const r of rows) for (const kind of requiredKinds(site(r))) {
      const due = dueAt(kind, site(r));
      if (due && due >= start && due < end && due < now && !(done.get(r.id)?.has(kind))) items.push({ site: label(r), document: kindLabel(kind, site(r)), dueAt: due.toISOString(), submittedAt: null, status: "missing" });
    }
    const count = (s: string) => items.filter((i) => i.status === s).length;
    const judged = items.length;
    return { month, onTime: count("on_time"), late: count("late"), missing: count("missing"), rate: judged ? Math.round((count("on_time") / judged) * 100) : null, items: items.sort((a, b) => b.dueAt.localeCompare(a.dueAt)) };
  }

  // ----- who may view, managed by Admin by exact email -----
  async access(actor: string, c: Db = this.pool) {
    if (!(await this.who(actor, c)).manage) throw new HttpError(403, "Only Admin can manage who sees site documents.");
    const grants = (await c.query(
      "SELECT a.created_at, a.granted_reason, u.email, u.display_name, u.role, u.active FROM qc_access a JOIN users u ON u.id=a.user_id ORDER BY lower(u.display_name)",
    )).rows.map((g) => ({ email: g.email as string, name: g.display_name as string, role: g.role as string, active: g.active as boolean, reason: g.granted_reason as string, since: g.created_at as string }));
    const events = (await c.query(
      `SELECT e.action, e.reason, e.ip, e.device, e.created_at, t.email, t.display_name AS name, a.display_name AS actor
       FROM qc_access_events e JOIN users t ON t.id=e.user_id JOIN users a ON a.id=e.actor ORDER BY e.created_at DESC LIMIT 200`,
    )).rows.map((e) => ({ action: e.action as string, reason: e.reason as string, ip: e.ip as string, device: e.device as string, at: e.created_at as string, email: e.email as string, name: e.name as string, actor: e.actor as string }));
    const people = (await c.query("SELECT email, display_name, role FROM users WHERE active AND role = ANY($1) ORDER BY lower(display_name)", [VIEWER_ROLES]))
      .rows.map((p) => ({ email: p.email as string, name: p.display_name as string, role: p.role as string }));
    return { grants, events, people };
  }
  async changeAccess(actor: string, input: { email: string; action: "grant" | "remove"; reason: string }, req?: Pick<Request, "ip" | "get" | "method" | "originalUrl">) {
    return transaction(this.pool, async (c) => {
      if (!(await this.who(actor, c)).manage) throw new HttpError(403, "Only Admin can manage who sees site documents.");
      const user = (await c.query("SELECT id, email, role, active FROM users WHERE email=$1", [input.email])).rows[0];
      if (!user?.active) throw new HttpError(404, "No active user has exactly that email.");
      const has = Boolean((await c.query("SELECT 1 FROM qc_access WHERE user_id=$1 AND capability='viewer' FOR UPDATE", [user.id])).rowCount);
      if (input.action === "grant") {
        if (!VIEWER_ROLES.includes(user.role)) throw new HttpError(422, "Site documents can be shared with Store and Accounts logins.");
        if (has) throw new HttpError(409, `${user.email} can already see site documents.`);
        await c.query("INSERT INTO qc_access(user_id, capability, granted_reason) VALUES($1,'viewer',$2)", [user.id, input.reason]);
      } else {
        if (!has) throw new HttpError(404, `${user.email} cannot see site documents.`);
        await c.query("DELETE FROM qc_access WHERE user_id=$1 AND capability='viewer'", [user.id]);
      }
      const where = clientOf(req);
      await c.query("INSERT INTO qc_access_events(user_id, capability, action, reason, actor, ip, device) VALUES($1,'viewer',$2,$3,$4,$5,$6)",
        [user.id, input.action, input.reason, actor, where.ip.slice(0, 64), where.device]);
      await securityEvent(c, `qc-access.${input.action}`, { id: actor }, `viewer for ${user.email}: ${input.reason}`, req, 200);
      return this.access(actor, c);
    });
  }
}
export { QC_KINDS };
