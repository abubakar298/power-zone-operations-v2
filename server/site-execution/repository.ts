import type { Pool, PoolClient } from "pg";
import { HttpError } from "../http/errors.js";
import { transaction } from "../db/transaction.js";
import {
  LATE_AFTER_DAYS,
  STAGE_LABELS,
  type FieldsInput,
  type Stage,
} from "./schema.js";

const WRITERS = new Set(["Admin", "Management", "Operations"]);
const READERS = new Set([
  "Admin",
  "Management",
  "Operations",
  "Inventory",
  "Accounts",
  "Coordinator",
]);
/** camelCase API field -> column. Region is on the site master, handled separately. */
const COLUMNS: Record<Exclude<keyof FieldsInput, "region">, string> = {
  siteType: "site_type",
  materialDeliveryPlanned: "material_delivery_planned",
  materialDeliveryActual: "material_delivery_actual",
  startDate: "start_date",
  endDate: "end_date",
  matriCloudStatus: "matri_cloud_status",
  fourGStatus: "four_g_status",
  customerSignoff: "customer_signoff",
  doDate: "do_date",
  acknowledgementDate: "acknowledgement_date",
  submittedToCustomerDate: "submitted_to_customer_date",
  advanceClaimed: "advance_claimed",
  finalClaimed: "final_claimed",
  documentsNote: "documents_note",
};

const DATE_COLUMNS = ["material_delivery_planned","material_delivery_actual","start_date","end_date","do_date","acknowledgement_date","submitted_to_customer_date"];
/** pg returns DATE as a JS Date at local midnight; the API speaks plain YYYY-MM-DD. */
export const dayString = (v: unknown): string | null =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`
    : v == null || v === ""
      ? null
      : String(v);

const LIST_SQL = `SELECT e.*, ${DATE_COLUMNS.map((c) => `to_char(e.${c},'YYYY-MM-DD') AS ${c}`).join(", ")},
  o.number AS boq_number, i.number AS ipo_number,
  i.snapshot->'customer'->>'name' AS customer, i.snapshot->>'siteName' AS site_name,
  i.snapshot->>'siteCode' AS site_code, i.snapshot->'input'->>'orderDate' AS po_date,
  s.region, s.name AS master_site_name,
  (SELECT count(*) FROM site_problems pr WHERE pr.execution_id=e.id AND pr.status='Open')::int AS open_problems,
  CASE WHEN e.start_date IS NULL OR e.start_date > CURRENT_DATE THEN 0 ELSE GREATEST(
    (LEAST(COALESCE(e.end_date, CURRENT_DATE), CURRENT_DATE) - e.start_date + 1)
    - (SELECT count(*) FROM site_photo_checks pc WHERE pc.execution_id=e.id AND pc.pictures
       AND pc.check_date BETWEEN e.start_date AND LEAST(COALESCE(e.end_date, CURRENT_DATE), CURRENT_DATE)), 0) END::int AS missing_picture_days
 FROM site_execution_records e
 JOIN operations_boq_issuances o ON o.id=e.issuance_id
 JOIN internal_purchase_orders i ON i.id=e.ipo_id
 LEFT JOIN sites s ON s.id=e.site_id`;

function shape(r: any) {
  const entered = new Date(r.stage_entered_at).getTime();
  const daysInStage = Math.floor((Date.now() - entered) / 86_400_000);
  return {
    id: r.id,
    jobKey: r.job_key,
    issuanceId: r.issuance_id,
    ipoId: r.ipo_id,
    ipoNumber: r.ipo_number,
    boqNumber: r.boq_number,
    customer: r.customer,
    siteName: r.site_name || r.master_site_name,
    siteCode: r.site_code,
    region: r.region || null,
    siteType: r.site_type,
    stage: r.stage as Stage,
    stageLabel: STAGE_LABELS[r.stage as Stage],
    stageEnteredAt: r.stage_entered_at,
    daysInStage,
    late: r.stage !== "closed" && daysInStage > LATE_AFTER_DAYS,
    poDate: r.po_date || null,
    materialDeliveryPlanned: r.material_delivery_planned,
    materialDeliveryActual: r.material_delivery_actual,
    startDate: r.start_date,
    endDate: r.end_date,
    matriCloudStatus: r.matri_cloud_status,
    fourGStatus: r.four_g_status,
    customerSignoff: r.customer_signoff,
    doDate: r.do_date,
    acknowledgementDate: r.acknowledgement_date,
    submittedToCustomerDate: r.submitted_to_customer_date,
    advanceClaimed: r.advance_claimed,
    finalClaimed: r.final_claimed,
    documentsNote: r.documents_note,
    openProblems: r.open_problems,
    missingPictureDays: r.missing_picture_days,
    updatedAt: r.updated_at,
  };
}
export type SiteExecution = ReturnType<typeof shape>;

export class SiteExecutionRepository {
  constructor(private pool: Pool) {}

  private async role(c: Pool | PoolClient, actor: string) {
    const u = (
      await c.query("SELECT role FROM users WHERE id=$1 AND active", [actor])
    ).rows[0];
    if (!u) throw new HttpError(403, "Your account is not active.");
    return u.role as string;
  }
  private async reader(c: Pool | PoolClient, actor: string) {
    const role = await this.role(c, actor);
    if (!READERS.has(role))
      throw new HttpError(403, "Your department does not have access to site operations.");
    return role;
  }
  private async writer(c: Pool | PoolClient, actor: string) {
    const role = await this.role(c, actor);
    if (!WRITERS.has(role))
      throw new HttpError(403, "Only Operations or Management can change a site record.");
    return role;
  }

  /** Every Operations issuance has exactly one site record; create the missing ones. */
  async ensure(c: Pool | PoolClient = this.pool) {
    await c.query(`INSERT INTO site_execution_records
      (job_key, issuance_id, ipo_id, site_id, customer_id, stage, stage_entered_at, site_type, created_at)
     SELECT 'ipo:' || o.ipo_id, o.id, o.ipo_id, b.site_id, b.customer_id,
      CASE WHEN s.id IS NOT NULL THEN 'dispatched' WHEN p.id IS NOT NULL THEN 'delivery_scheduled' ELSE 'ipo_received' END,
      COALESCE(s.created_at, p.created_at, o.created_at),
      CASE COALESCE(r.snapshot->'survey'->>'family','solar-hybrid') WHEN 'solar-hybrid' THEN 'Solar + BESS' WHEN 'bess-only' THEN 'BESS' ELSE NULL END,
      o.created_at
     FROM operations_boq_issuances o
     JOIN boq_revisions r ON r.id=o.boq_revision_id
     JOIN boqs b ON b.id=r.boq_id
     LEFT JOIN store_boq_issuances s ON s.issuance_id=o.id
     LEFT JOIN LATERAL (SELECT id, created_at FROM operations_delivery_plans WHERE issuance_id=o.id ORDER BY version DESC LIMIT 1) p ON true
     WHERE NOT EXISTS (SELECT 1 FROM site_execution_records e WHERE e.issuance_id=o.id)`);
  }

  async list(actor: string) {
    await this.reader(this.pool, actor);
    await this.ensure();
    const rows = (
      await this.pool.query(`${LIST_SQL} ORDER BY e.stage_entered_at ASC, e.created_at ASC LIMIT 1000`)
    ).rows;
    return rows.map(shape);
  }

  async get(actor: string, id: string, c: Pool | PoolClient = this.pool) {
    await this.reader(c, actor);
    const r = (await c.query(`${LIST_SQL} WHERE e.id=$1`, [id])).rows[0];
    if (!r) throw new HttpError(404, "Site record not found.");
    const [checks, problems, events, headsUp] = await Promise.all([
      c.query(
        "SELECT to_char(check_date,'YYYY-MM-DD') AS check_date, pictures, updated_at FROM site_photo_checks WHERE execution_id=$1 ORDER BY check_date",
        [id],
      ),
      c.query(
        `SELECT p.id, p.problem, p.status, p.created_at, p.resolved_at, p.resolution,
          u.display_name AS created_by, r.display_name AS resolved_by
         FROM site_problems p JOIN users u ON u.id=p.created_by LEFT JOIN users r ON r.id=p.resolved_by
         WHERE p.execution_id=$1 ORDER BY p.created_at DESC`,
        [id],
      ),
      c.query(
        `SELECT e.kind, e.from_stage, e.to_stage, e.changes, e.note, e.created_at, u.display_name AS actor
         FROM site_execution_events e JOIN users u ON u.id=e.created_by
         WHERE e.execution_id=$1 ORDER BY e.created_at DESC LIMIT 200`,
        [id],
      ),
      this.headsUp(r.issuance_id, c),
    ]);
    return {
      ...shape(r),
      photoChecks: checks.rows.map((c) => ({
        date: c.check_date,
        pictures: c.pictures,
        updatedAt: c.updated_at,
      })),
      problems: problems.rows.map((p) => ({
        id: p.id,
        problem: p.problem,
        status: p.status,
        createdBy: p.created_by,
        createdAt: p.created_at,
        resolvedBy: p.resolved_by,
        resolvedAt: p.resolved_at,
        resolution: p.resolution,
      })),
      events: events.rows.map((e) => ({
        kind: e.kind,
        fromStage: e.from_stage,
        toStage: e.to_stage,
        changes: e.changes,
        note: e.note,
        actor: e.actor,
        at: e.created_at,
      })),
      headsUp,
    };
  }

  /** Advance (heads-up) BOQ information linked to this issuance, when any exists. */
  private async headsUp(issuanceId: string, c: Pool | PoolClient = this.pool) {
    const planned = (
      await c.query(
        `SELECT d.number, d.created_at, a.mode, d.snapshot->>'expectedDate' AS expected_date,
          d.snapshot->>'notes' AS notes, jsonb_array_length(COALESCE(d.snapshot->'items','[]'::jsonb)) AS items
         FROM project_advance_planning a JOIN project_workflow_documents d ON d.id=a.document_id
         WHERE a.confirmed_issuance_id=$1`,
        [issuanceId],
      )
    ).rows[0];
    if (planned)
      return {
        source: "Advance BOQ",
        number: planned.number,
        mode: planned.mode,
        expectedDate: planned.expected_date,
        notes: planned.notes ?? "",
        items: Number(planned.items),
        createdAt: planned.created_at,
      };
    try {
      const group = (
        await c.query(
          `SELECT h.number, h.created_at, h.snapshot->>'label' AS label,
            jsonb_array_length(COALESCE(h.snapshot->'items','[]'::jsonb)) AS items
           FROM headsup_advance_final_links l
           JOIN headsup_advance_members m ON m.record_id=l.record_id
           JOIN headsup_department_handoffs h ON h.id=m.handoff_id
           WHERE l.operations_id=$1 LIMIT 1`,
          [issuanceId],
        )
      ).rows[0];
      if (group)
        return {
          source: "Heads-up group",
          number: group.number,
          mode: "Confirmed",
          expectedDate: null,
          notes: group.label ?? "",
          items: Number(group.items),
          createdAt: group.created_at,
        };
    } catch {
      /* heads-up group tables are optional for this view */
    }
    return null;
  }

  private async lock(c: PoolClient, id: string) {
    const r = (
      await c.query("SELECT * FROM site_execution_records WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!r) throw new HttpError(404, "Site record not found.");
    return r;
  }

  async setStage(actor: string, id: string, input: { stage: Stage; note: string }) {
    return transaction(this.pool, async (c) => {
      const role = await this.writer(c, actor);
      const r = await this.lock(c, id);
      if (r.stage === input.stage) return this.get(actor, id, c);
      if (input.stage === "closed" && !["Admin", "Management"].includes(role))
        throw new HttpError(403, "Only Management can close a site.");
      await c.query(
        "UPDATE site_execution_records SET stage=$2, stage_entered_at=now(), updated_by=$3, updated_at=now() WHERE id=$1",
        [id, input.stage, actor],
      );
      await c.query(
        "INSERT INTO site_execution_events(execution_id,kind,from_stage,to_stage,note,created_by) VALUES($1,'stage_change',$2,$3,$4,$5)",
        [id, r.stage, input.stage, input.note, actor],
      );
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `site-execution.stage:${id}:${input.stage}`,
      ]);
      return this.get(actor, id, c);
    });
  }

  async updateFields(actor: string, id: string, input: FieldsInput) {
    return transaction(this.pool, async (c) => {
      await this.writer(c, actor);
      const r = await this.lock(c, id);
      const next: Record<string, unknown> = {};
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const [field, column] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
        if (!(field in input)) continue;
        const to = input[field] ?? null;
        const from = DATE_COLUMNS.includes(column) ? dayString(r[column]) : (r[column] ?? null);
        if (String(from ?? "") === String(to ?? "")) continue;
        next[column] = to;
        changes[field] = { from, to };
      }
      const siteType = (next.site_type ?? r.site_type) as string | null;
      if (siteType === "UPS") {
        for (const column of ["matri_cloud_status", "four_g_status"]) {
          if ((next[column] ?? r[column]) != null) {
            next[column] = null;
            changes[column === "matri_cloud_status" ? "matriCloudStatus" : "fourGStatus"] = {
              from: r[column],
              to: null,
            };
          }
        }
      }
      const start = dayString(next.start_date ?? r.start_date);
      const end = dayString(next.end_date ?? r.end_date);
      if (start && end && end < start)
        throw new HttpError(400, "End date cannot be before the start date.");
      if ("region" in input && r.site_id) {
        const site = (await c.query("SELECT region FROM sites WHERE id=$1 FOR UPDATE", [r.site_id])).rows[0];
        const to = input.region ?? "";
        if (site && site.region !== to) {
          await c.query("UPDATE sites SET region=$2 WHERE id=$1", [r.site_id, to]);
          changes.region = { from: site.region || null, to: to || null };
        }
      }
      if (Object.keys(next).length) {
        const columns = Object.keys(next);
        await c.query(
          `UPDATE site_execution_records SET ${columns.map((col, i) => `${col}=$${i + 2}`).join(", ")}, updated_by=$${columns.length + 2}, updated_at=now() WHERE id=$1`,
          [id, ...columns.map((col) => next[col]), actor],
        );
      }
      if (Object.keys(changes).length) {
        await c.query(
          "INSERT INTO site_execution_events(execution_id,kind,changes,created_by) VALUES($1,'field_update',$2,$3)",
          [id, JSON.stringify(changes), actor],
        );
        await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
          actor,
          `site-execution.fields:${id}:${Object.keys(changes).join(",")}`,
        ]);
      }
      return this.get(actor, id, c);
    });
  }

  async setPhotoCheck(actor: string, id: string, input: { date: string; pictures: boolean }) {
    return transaction(this.pool, async (c) => {
      await this.writer(c, actor);
      const r = await this.lock(c, id);
      if (!r.start_date) throw new HttpError(400, "Enter the start date before recording picture checks.");
      if (input.date < (dayString(r.start_date) ?? ""))
        throw new HttpError(400, "Picture checks start on the start date.");
      await c.query(
        `INSERT INTO site_photo_checks(execution_id,check_date,pictures,updated_by) VALUES($1,$2,$3,$4)
         ON CONFLICT (execution_id,check_date) DO UPDATE SET pictures=EXCLUDED.pictures, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [id, input.date, input.pictures, actor],
      );
      await c.query(
        "INSERT INTO site_execution_events(execution_id,kind,changes,created_by) VALUES($1,'photo_check',$2,$3)",
        [id, JSON.stringify({ date: input.date, pictures: input.pictures }), actor],
      );
      return this.get(actor, id, c);
    });
  }

  async addProblem(actor: string, id: string, input: { problem: string }) {
    return transaction(this.pool, async (c) => {
      await this.writer(c, actor);
      await this.lock(c, id);
      const p = (
        await c.query(
          "INSERT INTO site_problems(execution_id,problem,created_by) VALUES($1,$2,$3) RETURNING id",
          [id, input.problem, actor],
        )
      ).rows[0];
      await c.query(
        "INSERT INTO site_execution_events(execution_id,kind,changes,note,created_by) VALUES($1,'problem_added',$2,$3,$4)",
        [id, JSON.stringify({ problemId: p.id }), input.problem.slice(0, 500), actor],
      );
      return this.get(actor, id, c);
    });
  }

  async resolveProblem(actor: string, id: string, problemId: string, input: { resolution: string }) {
    return transaction(this.pool, async (c) => {
      await this.writer(c, actor);
      await this.lock(c, id);
      const updated = await c.query(
        "UPDATE site_problems SET status='Resolved', resolved_by=$3, resolved_at=now(), resolution=$4 WHERE id=$2 AND execution_id=$1 AND status='Open'",
        [id, problemId, actor, input.resolution],
      );
      if (!updated.rowCount) throw new HttpError(404, "Open problem not found.");
      await c.query(
        "INSERT INTO site_execution_events(execution_id,kind,changes,note,created_by) VALUES($1,'problem_resolved',$2,$3,$4)",
        [id, JSON.stringify({ problemId }), input.resolution.slice(0, 500), actor],
      );
      return this.get(actor, id, c);
    });
  }
}
