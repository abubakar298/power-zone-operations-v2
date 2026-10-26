import type { Pool, PoolClient } from "pg";
import { HttpError } from "../http/errors.js";
import { transaction } from "../db/transaction.js";
import { assessQc, type QcKind } from "../quality/rules.js";
import {
  LATE_AFTER_DAYS,
  STAGE_LABELS,
  SCOPE_LABELS,
  VENDOR_CATEGORIES,
  nextStage,
  previousStage,
  type FieldsInput,
  type Scope,
  type Stage,
  type VendorInput,
} from "./schema.js";

const WRITERS = new Set(["Admin", "Management", "Operations"]);
const READERS = new Set(["Admin", "Management", "Operations", "Inventory", "Accounts", "Coordinator"]);
/** BOQ lines treated as cables for the variance check. */
const CABLE_LINE = "cable";

/** camelCase API field -> column. Region lives on the site master and is handled separately. */
const COLUMNS: Record<Exclude<keyof FieldsInput, "region">, string> = {
  siteType: "site_type",
  scope: "scope",
  expectedStart: "expected_start",
  expectedDelivery: "expected_delivery",
  expectedCompletion: "expected_completion",
  deliveredOn: "delivered_on",
  bessDeliveredOn: "bess_delivered_on",
  startedOn: "started_on",
  installationCompletedOn: "installation_completed_on",
  commissionedOn: "commissioned_on",
  matriCloud: "matri_cloud",
  fourG: "four_g",
  handedOverOn: "handed_over_on",
  customerSignoff: "customer_signoff",
  doDate: "do_date",
  acknowledgementDate: "acknowledgement_date",
  submittedToCustomerDate: "submitted_to_customer_date",
  advanceClaimed: "advance_claimed",
  finalClaimed: "final_claimed",
  documentsNote: "documents_note",
  notes: "notes",
};
const DATE_COLUMNS = [
  "expected_start", "expected_delivery", "expected_completion", "delivered_on", "bess_delivered_on", "started_on", "installation_completed_on",
  "commissioned_on", "handed_over_on", "do_date", "acknowledgement_date", "submitted_to_customer_date",
];
/** pg returns DATE as a JS Date at local midnight; the API speaks plain YYYY-MM-DD. */
export const dayString = (v: unknown): string | null =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`
    : v == null || v === "" ? null : String(v);
const today = () => dayString(new Date())!;
const n = (v: unknown) => (v == null ? 0 : Number(v));
const fixed = (v: number) => v.toFixed(6).replace(/\.?0+$/, "").replace(/^-0$/, "0");

const LIST_SQL = `SELECT w.*, ${DATE_COLUMNS.map((c) => `to_char(w.${c},'YYYY-MM-DD') AS ${c}`).join(", ")},
  o.number AS boq_number, i.number AS ipo_number,
  i.snapshot->'customer'->>'name' AS customer, i.snapshot->>'siteName' AS site_name,
  i.snapshot->>'siteCode' AS site_code, i.snapshot->'input'->>'orderDate' AS po_date,
  s.region, s.name AS master_site_name, u.display_name AS updated_by_name,
  (SELECT count(*) FROM site_workflow_problems pr WHERE pr.workflow_id=w.id AND pr.status='Open')::int AS open_problems,
  CASE WHEN w.scope IS DISTINCT FROM 'installation' OR w.started_on IS NULL OR w.started_on > CURRENT_DATE THEN 0 ELSE GREATEST(
    (LEAST(COALESCE(w.installation_completed_on, CURRENT_DATE), CURRENT_DATE) - w.started_on + 1)
    - (SELECT count(*) FROM site_workflow_picture_days p WHERE p.workflow_id=w.id AND p.pictures
       AND p.day BETWEEN w.started_on AND LEAST(COALESCE(w.installation_completed_on, CURRENT_DATE), CURRENT_DATE)), 0) END::int AS missing_picture_days,
  (SELECT COALESCE(array_agg(DISTINCT q.kind), '{}') FROM qc_submissions q WHERE q.workflow_id=w.id) AS qc_done
 FROM site_workflow w
 JOIN operations_boq_issuances o ON o.id=w.issuance_id
 JOIN internal_purchase_orders i ON i.id=w.ipo_id
 LEFT JOIN sites s ON s.id=w.site_id
 LEFT JOIN users u ON u.id=w.updated_by`;

const STAGE_ORDER: Record<Stage, number> = { ipo_received: 0, planning: 1, delivery: 2, installation: 3, commissioning: 4, handover: 5, doc_dispatch: 6, closed: 7 };

function shape(r: any) {
  const stage = r.stage as Stage, scope = (r.scope ?? null) as Scope | null;
  const daysInStage = Math.floor((Date.now() - new Date(r.stage_entered_at).getTime()) / 86_400_000);
  const t = today();
  const overdue: string[] = [];
  if (stage !== "closed") {
    if (r.expected_delivery && r.expected_delivery < t && !r.delivered_on) overdue.push("delivery");
    if (scope !== "delivery_only" && r.expected_start && r.expected_start < t && !r.started_on) overdue.push("start");
    if (scope !== "delivery_only" && r.expected_completion && r.expected_completion < t && !r.handed_over_on) overdue.push("completion");
  }
  return {
    id: r.id as string,
    issuanceId: r.issuance_id as string,
    ipoId: r.ipo_id as string,
    ipoNumber: r.ipo_number as string,
    boqNumber: r.boq_number as string,
    customer: (r.customer ?? null) as string | null,
    siteName: (r.site_name || r.master_site_name || null) as string | null,
    siteCode: (r.site_code ?? null) as string | null,
    region: (r.region || null) as string | null,
    siteType: (r.site_type ?? null) as string | null,
    stage,
    stageLabel: STAGE_LABELS[stage],
    stageOrder: STAGE_ORDER[stage],
    stageEnteredAt: r.stage_entered_at as string,
    daysInStage,
    late: stage !== "closed" && daysInStage > LATE_AFTER_DAYS,
    overdue,
    scope,
    scopeLabel: scope ? SCOPE_LABELS[scope] : null,
    nextStage: nextStage(stage, scope),
    previousStage: previousStage(stage, scope),
    poDate: (r.po_date || null) as string | null,
    expectedStart: r.expected_start as string | null,
    expectedDelivery: r.expected_delivery as string | null,
    expectedCompletion: r.expected_completion as string | null,
    deliveredOn: r.delivered_on as string | null,
    bessDeliveredOn: (r.bess_delivered_on ?? null) as string | null,
    startedOn: r.started_on as string | null,
    installationCompletedOn: r.installation_completed_on as string | null,
    commissionedOn: r.commissioned_on as string | null,
    matriCloud: (r.matri_cloud ?? null) as string | null,
    fourG: (r.four_g ?? null) as string | null,
    handedOverOn: r.handed_over_on as string | null,
    customerSignoff: (r.customer_signoff ?? null) as boolean | null,
    doDate: r.do_date as string | null,
    acknowledgementDate: r.acknowledgement_date as string | null,
    submittedToCustomerDate: r.submitted_to_customer_date as string | null,
    advanceClaimed: Boolean(r.advance_claimed),
    finalClaimed: Boolean(r.final_claimed),
    documentsNote: (r.documents_note ?? "") as string,
    notes: (r.notes ?? "") as string,
    closedAt: (r.closed_at ?? null) as string | null,
    openProblems: r.open_problems as number,
    missingPictureDays: r.missing_picture_days as number,
    // Quality Control documents: what is in, what is missing, and whether the site is red (26 Oct 2026).
    qc: assessQc({ siteType: r.site_type ?? null, scope, deliveredOn: r.delivered_on ?? null, bessDeliveredOn: r.bess_delivered_on ?? null }, new Set((r.qc_done ?? []) as QcKind[])),
    updatedAt: r.updated_at as string,
    updatedBy: (r.updated_by_name ?? null) as string | null,
  };
}
export type SiteRow = ReturnType<typeof shape>;

function cableRow(l: any) {
  const boq = n(l.boq_qty), used = l.used_qty == null ? null : n(l.used_qty), returned = n(l.returned_qty);
  const variance = used == null ? null : used - boq;
  return {
    itemKey: l.item_key as string,
    name: (l.display_name ?? l.item_key) as string,
    unit: l.unit as string,
    boqQty: fixed(boq),
    usedQty: used == null ? null : fixed(used),
    returnedQty: fixed(returned),
    variance: variance == null ? null : fixed(variance),
    direction:
      variance == null ? "Not entered"
      : variance > 1e-9 ? "Extra used: invoice the customer"
      : variance < -1e-9 ? "Less used: refund if charged"
      : "Matches BOQ",
    flagged: variance != null && Math.abs(variance) > 1e-9,
    note: (l.note ?? "") as string,
    updatedAt: (l.updated_at ?? null) as string | null,
    updatedBy: (l.updated_by_name ?? null) as string | null,
  };
}
const CABLES_SQL = `SELECT d.item_key, d.unit, SUM(d.quantity) AS boq_qty, MIN(m.display_name) AS display_name,
    c.used_qty, c.returned_qty, c.note, c.updated_at, ub.display_name AS updated_by_name
   FROM operations_stock_demand d LEFT JOIN item_master m ON m.key=d.item_key
   LEFT JOIN site_workflow_cables c ON c.workflow_id=$2 AND c.item_key=d.item_key
   LEFT JOIN users ub ON ub.id=c.updated_by
   WHERE d.issuance_id=$1 AND (d.item_key ~* $3 OR COALESCE(d.specification,'') ~* $3)
   GROUP BY d.item_key, d.unit, c.used_qty, c.returned_qty, c.note, c.updated_at, ub.display_name
   ORDER BY d.item_key`;

const vendorShape = (v: any) => ({
  id: v.id as string, name: v.name as string, category: v.category as string, contactPerson: v.contact_person as string,
  phone: v.phone as string, notes: v.notes as string, status: v.status as "Active" | "Inactive",
});

export class SiteWorkflowRepository {
  constructor(private pool: Pool) {}

  private async role(c: Pool | PoolClient, actor: string) {
    const u = (await c.query("SELECT role FROM users WHERE id=$1 AND active", [actor])).rows[0];
    if (!u) throw new HttpError(403, "Your account is not active.");
    return u.role as string;
  }
  private async reader(c: Pool | PoolClient, actor: string) {
    const role = await this.role(c, actor);
    if (!READERS.has(role)) throw new HttpError(403, "Your department does not have access to site operations.");
    return role;
  }
  private async writer(c: Pool | PoolClient, actor: string) {
    const role = await this.role(c, actor);
    if (!WRITERS.has(role)) throw new HttpError(403, "Only Operations or Management can change a site.");
    return role;
  }
  private async event(c: PoolClient, id: string, kind: string, actor: string, changes: unknown = {}, note = "", stages?: { from: Stage; to: Stage }) {
    await c.query(
      "INSERT INTO site_workflow_events(workflow_id,kind,from_stage,to_stage,changes,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [id, kind, stages?.from ?? null, stages?.to ?? null, JSON.stringify(changes), note, actor],
    );
  }
  private async audit(c: PoolClient, actor: string, action: string) {
    await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [actor, action]);
  }
  private async lock(c: PoolClient, id: string) {
    const r = (await c.query(`${LIST_SQL} WHERE w.id=$1 FOR UPDATE OF w`, [id])).rows[0];
    if (!r) throw new HttpError(404, "Site not found.");
    return shape(r);
  }

  /** Every Operations issuance has exactly one workflow row; create the missing ones. */
  async ensure(c: Pool | PoolClient = this.pool) {
    await c.query(`INSERT INTO site_workflow (issuance_id, ipo_id, site_id, customer_id, stage, stage_entered_at, site_type, created_at)
     SELECT o.id, o.ipo_id, b.site_id, b.customer_id,
      CASE WHEN s.id IS NOT NULL THEN 'delivery' ELSE 'ipo_received' END, COALESCE(s.created_at, o.created_at),
      CASE COALESCE(r.snapshot->'survey'->>'family','solar-hybrid') WHEN 'solar-hybrid' THEN 'Solar + BESS' WHEN 'bess-only' THEN 'BESS' ELSE NULL END,
      o.created_at
     FROM operations_boq_issuances o
     JOIN boq_revisions r ON r.id=o.boq_revision_id
     JOIN boqs b ON b.id=r.boq_id
     LEFT JOIN store_boq_issuances s ON s.issuance_id=o.id
     WHERE NOT EXISTS (SELECT 1 FROM site_workflow w WHERE w.issuance_id=o.id)`);
  }

  async list(actor: string) {
    await this.reader(this.pool, actor);
    await this.ensure();
    return (await this.pool.query(`${LIST_SQL} ORDER BY w.stage_entered_at ASC, w.created_at ASC LIMIT 1000`)).rows.map(shape);
  }

  async get(actor: string, id: string, c: Pool | PoolClient = this.pool) {
    await this.reader(c, actor);
    const row = (await c.query(`${LIST_SQL} WHERE w.id=$1`, [id])).rows[0];
    if (!row) throw new HttpError(404, "Site not found.");
    const site = shape(row);
    const [vendors, pictureDays, problems, cables, additionalItems, events] = await Promise.all([
      c.query(
        `SELECT a.id, a.category, a.vendor_id, to_char(a.agreed_date,'YYYY-MM-DD') AS agreed_date, a.notes, a.created_at, u.display_name AS assigned_by,
          v.name AS vendor_name, v.contact_person, v.phone
         FROM site_workflow_vendor_assignments a JOIN site_workflow_vendors v ON v.id=a.vendor_id JOIN users u ON u.id=a.created_by
         WHERE a.workflow_id=$1 AND a.removed_at IS NULL ORDER BY a.category`,
        [id],
      ),
      c.query("SELECT to_char(day,'YYYY-MM-DD') AS day, pictures FROM site_workflow_picture_days WHERE workflow_id=$1 ORDER BY day", [id]),
      c.query(
        `SELECT p.*, u.display_name AS created_by_name, r.display_name AS resolved_by_name FROM site_workflow_problems p
         JOIN users u ON u.id=p.created_by LEFT JOIN users r ON r.id=p.resolved_by WHERE p.workflow_id=$1 ORDER BY p.created_at DESC`,
        [id],
      ),
      c.query(CABLES_SQL, [site.issuanceId, id, CABLE_LINE]),
      c.query(
        `SELECT a.*, u.display_name AS created_by_name, r.display_name AS withdrawn_by_name FROM site_workflow_additional_items a
         JOIN users u ON u.id=a.created_by LEFT JOIN users r ON r.id=a.withdrawn_by WHERE a.workflow_id=$1 ORDER BY a.created_at DESC`,
        [id],
      ),
      c.query(
        `SELECT e.*, u.display_name AS actor FROM site_workflow_events e JOIN users u ON u.id=e.created_by WHERE e.workflow_id=$1 ORDER BY e.created_at DESC LIMIT 300`,
        [id],
      ),
    ]);
    return {
      ...site,
      vendors: vendors.rows.map((a) => ({
        id: a.id as string, category: a.category as string, vendorId: a.vendor_id as string, vendorName: a.vendor_name as string,
        contactPerson: a.contact_person as string, phone: a.phone as string, agreedDate: a.agreed_date as string | null,
        notes: a.notes as string, assignedBy: a.assigned_by as string, assignedAt: a.created_at as string,
      })),
      pictureDays: pictureDays.rows.map((p) => ({ day: p.day as string, pictures: Boolean(p.pictures) })),
      problems: problems.rows.map((p) => ({
        id: p.id as string, problem: p.problem as string, status: p.status as "Open" | "Resolved", raisedBy: p.created_by_name as string,
        raisedAt: p.created_at as string, resolvedBy: (p.resolved_by_name ?? null) as string | null, resolvedAt: (p.resolved_at ?? null) as string | null,
        resolution: p.resolution as string,
      })),
      cables: cables.rows.map(cableRow),
      additionalItems: additionalItems.rows.map((a) => ({
        id: a.id as string, description: a.description as string, quantity: fixed(n(a.quantity)), unit: a.unit as string, reason: a.reason as string,
        addedBy: a.created_by_name as string, addedAt: a.created_at as string, withdrawnAt: (a.withdrawn_at ?? null) as string | null,
        withdrawnBy: (a.withdrawn_by_name ?? null) as string | null, withdrawalReason: a.withdrawal_reason as string,
      })),
      events: events.rows.map((e) => ({
        id: e.id as string, kind: e.kind as string, fromStage: (e.from_stage ?? null) as Stage | null, toStage: (e.to_stage ?? null) as Stage | null,
        changes: e.changes as Record<string, any>, note: e.note as string, actor: e.actor as string, at: e.created_at as string,
      })),
    };
  }
  /** What must be in place before a site may leave its current stage. */
  private gate(site: SiteRow, to: Stage) {
    const need = (ok: unknown, what: string) => { if (!ok) throw new HttpError(422, `Enter ${what} before moving to ${STAGE_LABELS[to]}.`); };
    switch (site.stage) {
      case "planning": need(site.expectedDelivery, "the expected delivery date"); break;
      case "delivery":
        if (!site.scope) throw new HttpError(422, "Decide first: installation and commissioning by us, or delivery only.");
        need(site.deliveredOn, "the delivery date");
        break;
      case "installation": need(site.startedOn, "the installation start date"); break;
      case "commissioning": need(site.commissionedOn, "the commissioning date"); break;
      case "handover": need(site.handedOverOn, "the handover date"); break;
      case "doc_dispatch": need(site.submittedToCustomerDate, "the date the documents were submitted to the customer"); break;
      default: break;
    }
  }
  private async move(c: PoolClient, actor: string, id: string, to: Stage, kind: "stage_forward" | "stage_back", note: string, from: Stage) {
    await c.query(
      "UPDATE site_workflow SET stage=$2, stage_entered_at=now(), closed_at=CASE WHEN $2='closed' THEN now() ELSE NULL END, updated_by=$3, updated_at=now() WHERE id=$1",
      [id, to, actor],
    );
    await this.event(c, id, kind, actor, {}, note, { from, to });
    await this.audit(c, actor, `site-workflow.${kind}:${id}:${from}>${to}`);
  }

  /** Move to the next stage. Delivery branches on the scope: installation, or straight to Closed. */
  async forward(actor: string, id: string, input: { note: string }) {
    return transaction(this.pool, async (c) => {
      await this.writer(c, actor);
      const site = await this.lock(c, id);
      const to = nextStage(site.stage, site.scope);
      if (!to) throw new HttpError(422, site.stage === "closed" ? "This site is closed." : "Decide first: installation and commissioning by us, or delivery only.");
      this.gate(site, to);
      // A site closes only once Quality Control has submitted every required document (Moaz, 26 Oct 2026).
      if (to === "closed" && site.qc.missing.length)
        throw new HttpError(422, `Quality Control documents are still missing: ${site.qc.missing.join(", ")}. The site can close once they are submitted.`);
      await this.move(c, actor, id, to, "stage_forward", input.note, site.stage);
      return this.get(actor, id, c);
    });
  }
  /** Step back one stage to correct a mistake. The note says why. */
  async back(actor: string, id: string, input: { note: string }) {
    return transaction(this.pool, async (c) => {
      await this.writer(c, actor);
      const site = await this.lock(c, id);
      const to = previousStage(site.stage, site.scope);
      if (!to) throw new HttpError(422, "This site is at the first stage.");
      if (!input.note.trim()) throw new HttpError(422, "Say why the site is going back a stage.");
      await this.move(c, actor, id, to, "stage_back", input.note, site.stage);
      return this.get(actor, id, c);
    });
  }

  async update(actor: string, id: string, input: FieldsInput) {
    return transaction(this.pool, async (c) => {
      await this.writer(c, actor);
      const site = await this.lock(c, id);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const sets: string[] = [], values: unknown[] = [id];
      const next = { ...site, ...input } as Record<string, unknown>;
      if (input.scope !== undefined && input.scope !== site.scope && !["ipo_received", "planning", "delivery"].includes(site.stage))
        throw new HttpError(422, "Go back to Delivery to change whether we install and commission.");
      if (next.startedOn && next.installationCompletedOn && String(next.installationCompletedOn) < String(next.startedOn))
        throw new HttpError(422, "Installation cannot finish before it starts.");
      if (next.siteType === "UPS") { input.matriCloud = null; input.fourG = null; }
      for (const [field, column] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
        if (input[field] === undefined) continue;
        const to = input[field] ?? null, from = (site as Record<string, unknown>)[field] ?? null;
        if (to === from) continue;
        values.push(to);
        sets.push(`${column}=$${values.length}`);
        changes[field] = { from, to };
      }
      if (input.region !== undefined && input.region !== site.region) {
        const siteId = (await c.query("SELECT site_id FROM site_workflow WHERE id=$1", [id])).rows[0]?.site_id;
        if (!siteId) throw new HttpError(422, "This record is not linked to a site master, so its region cannot be set.");
        await c.query("UPDATE sites SET region=$2 WHERE id=$1", [siteId, input.region ?? ""]);
        changes.region = { from: site.region, to: input.region ?? null };
      }
      if (sets.length) {
        values.push(actor);
        await c.query(`UPDATE site_workflow SET ${sets.join(", ")}, updated_by=$${values.length}, updated_at=now() WHERE id=$1`, values);
      }
      if (Object.keys(changes).length) {
        await this.event(c, id, "field_update", actor, changes);
        await this.audit(c, actor, `site-workflow.update:${id}`);
      }
      return this.get(actor, id, c);
    });
  }

  async setPictures(actor: string, id: string, input: { day: string; pictures: boolean }) {
    return transaction(this.pool, async (c) => {
      await this.writer(c, actor);
      const site = await this.lock(c, id);
      if (!site.startedOn) throw new HttpError(422, "Enter the installation start date first.");
      const last = site.installationCompletedOn ?? today();
      if (input.day < site.startedOn || input.day > last) throw new HttpError(422, `Picture days run from ${site.startedOn} to ${last}.`);
      await c.query(
        `INSERT INTO site_workflow_picture_days(workflow_id,day,pictures,updated_by) VALUES($1,$2,$3,$4)
         ON CONFLICT (workflow_id,day) DO UPDATE SET pictures=EXCLUDED.pictures, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [id, input.day, input.pictures, actor],
      );
      await this.event(c, id, "pictures", actor, { day: input.day, pictures: input.pictures });
      return this.get(actor, id, c);
    });
  }

  async addProblem(actor: string, id: string, input: { problem: string }) {
    return transaction(this.pool, async (c) => {
      await this.writer(c, actor);
      await this.lock(c, id);
      const p = (await c.query("INSERT INTO site_workflow_problems(workflow_id,problem,created_by) VALUES($1,$2,$3) RETURNING id", [id, input.problem, actor])).rows[0];
      await this.event(c, id, "problem_added", actor, { problemId: p.id }, input.problem);
      await this.audit(c, actor, `site-workflow.problem:${id}:${p.id}`);
      return this.get(actor, id, c);
    });
  }
  async resolveProblem(actor: string, id: string, problemId: string, input: { resolution: string }) {
    return transaction(this.pool, async (c) => {
      await this.writer(c, actor);
      await this.lock(c, id);
      const r = await c.query(
        "UPDATE site_workflow_problems SET status='Resolved', resolved_by=$3, resolved_at=now(), resolution=$4 WHERE id=$2 AND workflow_id=$1 AND status='Open'",
        [id, problemId, actor, input.resolution],
      );
      if (!r.rowCount) throw new HttpError(404, "Open problem not found.");
      await this.event(c, id, "problem_resolved", actor, { problemId }, input.resolution);
      return this.get(actor, id, c);
    });
  }

  async vendors(actor: string) {
    await this.reader(this.pool, actor);
    return {
      vendors: (await this.pool.query("SELECT * FROM site_workflow_vendors ORDER BY category, lower(name)")).rows.map(vendorShape),
      categories: VENDOR_CATEGORIES,
    };
  }
  async saveVendor(actor: string, input: VendorInput) {
    return transaction(this.pool, async (c) => {
      await this.writer(c, actor);
      const clash = (await c.query(
        "SELECT id FROM site_workflow_vendors WHERE lower(btrim(name))=lower(btrim($1)) AND category=$2 AND id IS DISTINCT FROM $3",
        [input.name, input.category, input.id ?? null],
      )).rows[0];
      if (clash) throw new HttpError(409, `${input.name} already exists under ${input.category}.`);
      const row = input.id
        ? (await c.query(
            "UPDATE site_workflow_vendors SET name=$2, category=$3, contact_person=$4, phone=$5, notes=$6, status=$7, updated_by=$8, updated_at=now() WHERE id=$1 RETURNING *",
            [input.id, input.name, input.category, input.contactPerson, input.phone, input.notes, input.status, actor],
          )).rows[0]
        : (await c.query(
            "INSERT INTO site_workflow_vendors(name,category,contact_person,phone,notes,status,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *",
            [input.name, input.category, input.contactPerson, input.phone, input.notes, input.status, actor],
          )).rows[0];
      if (!row) throw new HttpError(404, "Vendor not found.");
      await this.audit(c, actor, `site-workflow.vendor:${row.id}`);
      return vendorShape(row);
    });
  }
  async assignVendor(actor: string, id: string, input: { category: string; vendorId: string; agreedDate: string | null; notes: string }) {
    return transaction(this.pool, async (c) => {
      await this.writer(c, actor);
      await this.lock(c, id);
      const vendor = (await c.query("SELECT name, category, status FROM site_workflow_vendors WHERE id=$1", [input.vendorId])).rows[0];
      if (!vendor) throw new HttpError(404, "Vendor not found.");
      if (vendor.category !== input.category) throw new HttpError(422, `${vendor.name} is a ${vendor.category} vendor, not ${input.category}.`);
      if (vendor.status !== "Active") throw new HttpError(422, `${vendor.name} is inactive.`);
      const current = (await c.query("SELECT id FROM site_workflow_vendor_assignments WHERE workflow_id=$1 AND category=$2 AND removed_at IS NULL", [id, input.category])).rows[0];
      if (current) throw new HttpError(409, `This site already has a ${input.category} vendor. Remove it first.`);
      const a = (await c.query(
        "INSERT INTO site_workflow_vendor_assignments(workflow_id,category,vendor_id,agreed_date,notes,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
        [id, input.category, input.vendorId, input.agreedDate, input.notes, actor],
      )).rows[0];
      await this.event(c, id, "vendor_assigned", actor, { assignmentId: a.id, category: input.category, vendor: vendor.name, agreedDate: input.agreedDate }, input.notes);
      return this.get(actor, id, c);
    });
  }
  async removeVendor(actor: string, id: string, assignmentId: string, input: { reason: string }) {
    return transaction(this.pool, async (c) => {
      await this.writer(c, actor);
      await this.lock(c, id);
      const r = await c.query(
        `UPDATE site_workflow_vendor_assignments a SET removed_by=$3, removed_at=now(), removal_reason=$4 FROM site_workflow_vendors v
         WHERE a.id=$2 AND a.workflow_id=$1 AND a.removed_at IS NULL AND v.id=a.vendor_id RETURNING a.category, v.name`,
        [id, assignmentId, actor, input.reason],
      );
      if (!r.rowCount) throw new HttpError(404, "Vendor assignment not found.");
      await this.event(c, id, "vendor_removed", actor, { assignmentId, category: r.rows[0].category, vendor: r.rows[0].name }, input.reason);
      return this.get(actor, id, c);
    });
  }

  async setCable(actor: string, id: string, input: { itemKey: string; usedQty: string; returnedQty: string; note: string }) {
    return transaction(this.pool, async (c) => {
      await this.writer(c, actor);
      const site = await this.lock(c, id);
      const line = (await c.query(
        "SELECT 1 FROM operations_stock_demand WHERE issuance_id=$1 AND item_key=$2 AND (item_key ~* $3 OR COALESCE(specification,'') ~* $3)",
        [site.issuanceId, input.itemKey, CABLE_LINE],
      )).rowCount;
      if (!line) throw new HttpError(400, "That item is not a cable line on this site's BOQ.");
      const before = (await c.query("SELECT used_qty, returned_qty FROM site_workflow_cables WHERE workflow_id=$1 AND item_key=$2", [id, input.itemKey])).rows[0];
      await c.query(
        `INSERT INTO site_workflow_cables(workflow_id,item_key,used_qty,returned_qty,note,updated_by) VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT (workflow_id,item_key) DO UPDATE SET used_qty=EXCLUDED.used_qty, returned_qty=EXCLUDED.returned_qty, note=EXCLUDED.note, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [id, input.itemKey, input.usedQty, input.returnedQty, input.note, actor],
      );
      await this.event(c, id, "cable_usage", actor, {
        itemKey: input.itemKey, usedQty: input.usedQty, returnedQty: input.returnedQty,
        previous: before ? { usedQty: fixed(n(before.used_qty)), returnedQty: fixed(n(before.returned_qty)) } : null,
      }, input.note);
      return this.get(actor, id, c);
    });
  }

  async addAdditionalItem(actor: string, id: string, input: { description: string; quantity: string; unit: string; reason: string }) {
    return transaction(this.pool, async (c) => {
      await this.writer(c, actor);
      await this.lock(c, id);
      const a = (await c.query(
        "INSERT INTO site_workflow_additional_items(workflow_id,description,quantity,unit,reason,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
        [id, input.description, input.quantity, input.unit, input.reason, actor],
      )).rows[0];
      await this.event(c, id, "additional_item", actor, { itemId: a.id, description: input.description, quantity: input.quantity, unit: input.unit }, input.reason);
      await this.audit(c, actor, `site-workflow.additional:${id}:${a.id}`);
      return this.get(actor, id, c);
    });
  }
  async withdrawAdditionalItem(actor: string, id: string, itemId: string, input: { reason: string }) {
    return transaction(this.pool, async (c) => {
      await this.writer(c, actor);
      await this.lock(c, id);
      const r = await c.query(
        "UPDATE site_workflow_additional_items SET withdrawn_by=$3, withdrawn_at=now(), withdrawal_reason=$4 WHERE id=$2 AND workflow_id=$1 AND withdrawn_at IS NULL RETURNING description",
        [id, itemId, actor, input.reason],
      );
      if (!r.rowCount) throw new HttpError(404, "Additional item not found.");
      await this.event(c, id, "additional_item_withdrawn", actor, { itemId, description: r.rows[0].description }, input.reason);
      return this.get(actor, id, c);
    });
  }

  /** Site report: every site with its stage and dates, cable variances, and additional items for Accounts. */
  async report(actor: string) {
    await this.reader(this.pool, actor);
    await this.ensure();
    const sites = (await this.pool.query(`${LIST_SQL} ORDER BY w.stage_entered_at ASC`)).rows.map(shape);
    const cableRows = (await this.pool.query(
      `SELECT c.workflow_id, d.item_key, d.unit, SUM(d.quantity) AS boq_qty, MIN(m.display_name) AS display_name,
        c.used_qty, c.returned_qty, c.note, c.updated_at, ub.display_name AS updated_by_name
       FROM site_workflow_cables c JOIN site_workflow w ON w.id=c.workflow_id
       JOIN operations_stock_demand d ON d.issuance_id=w.issuance_id AND d.item_key=c.item_key
       LEFT JOIN item_master m ON m.key=d.item_key LEFT JOIN users ub ON ub.id=c.updated_by
       GROUP BY c.workflow_id, d.item_key, d.unit, c.used_qty, c.returned_qty, c.note, c.updated_at, ub.display_name
       ORDER BY c.workflow_id, d.item_key`,
    )).rows;
    const itemRows = (await this.pool.query(
      `SELECT a.*, u.display_name AS created_by_name FROM site_workflow_additional_items a JOIN users u ON u.id=a.created_by
       WHERE a.withdrawn_at IS NULL ORDER BY a.created_at DESC`,
    )).rows;
    const byId = new Map(sites.map((s) => [s.id, s]));
    const site = (id: string) => { const s = byId.get(id); return { siteId: id, siteName: s?.siteName ?? null, siteCode: s?.siteCode ?? null, customer: s?.customer ?? null, region: s?.region ?? null, stage: s?.stage ?? null }; };
    return {
      sites,
      cables: cableRows.map((r) => ({ ...site(r.workflow_id), ...cableRow(r) })),
      additionalItems: itemRows.map((a) => ({
        ...site(a.workflow_id), id: a.id as string, description: a.description as string, quantity: fixed(n(a.quantity)), unit: a.unit as string,
        reason: a.reason as string, addedBy: a.created_by_name as string, addedAt: a.created_at as string,
      })),
    };
  }
}
