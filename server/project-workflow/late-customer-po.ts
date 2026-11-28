import { Decimal } from "decimal.js";
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HttpError } from "../http/errors.js";
import { latePoException } from "../../shared/late-customer-po-exceptions.js";

/**
 * Customer PO received later (user request, 24 Nov 2026).
 * A site confirmed on the customer's written approval (email or WhatsApp) can have its formal PO attached after the
 * IPO is issued. Each attachment is a new immutable row in project_late_customer_pos (migration 310); the issued
 * IPO, its number and its PDF never change. A correction is the next version for the same site.
 */
export const latePoFileKind = "Customer PO (received later)";
const approvalTypes = ["WhatsApp approval", "Email approval"];

export const latePoSchema = z.object({
  fileId: z.uuid(),
  poNumber: z.string().trim().min(1).max(100).refine((value) => !/^n\/?a$/i.test(value), "Enter the customer PO number."),
  poDate: z.iso.date(),
  poAmount: z.union([z.literal(""), z.string().trim().regex(/^\d{1,13}(\.\d{1,2})?$/, "Enter the PO amount in rupees, for example 900000.00")]).default(""),
  notes: z.string().trim().min(1, "Enter a note about the received PO.").max(4000),
}).strict();

type Db = Pool | PoolClient;

/** Received-later PO is for email/WhatsApp approvals, plus the owner-approved exceptions in shared/late-customer-po-exceptions.ts. */
export const latePoAllowed = (evidenceType: string | null | undefined, recordId: string) =>
  approvalTypes.includes(evidenceType ?? "") || latePoException(recordId);

/** The issued IPO a received PO belongs to: the record's first IPO decides eligibility, the latest (revision) its amount. */
export async function latePoTarget(c: Db, r: { id: string; stage: string; data: any }) {
  if (r.stage !== "issued" || !r.data?.ipoId)
    throw new HttpError(409, "Attach the customer PO after the IPO is issued.");
  const rows = (await c.query(
    "SELECT id,number,snapshot->'input'->>'evidenceType' AS evidence_type,snapshot#>>'{allocation,total}' AS total,snapshot->'historicalImport' AS historical,created_at FROM internal_purchase_orders WHERE id=$1 OR snapshot->>'workflowRecordId'=$2 ORDER BY created_at DESC,id",
    [r.data.ipoId, r.id],
  )).rows;
  const original = rows.find((row) => row.id === r.data.ipoId);
  if (!original) throw new HttpError(409, "The issued IPO for this site was not found.");
  if (original.historical && original.historical !== false)
    throw new HttpError(409, "Historical imported IPOs keep their source register; attach no new customer PO here.");
  if (!latePoAllowed(original.evidence_type, r.id))
    throw new HttpError(409, "This IPO was issued on a customer PO. A received-later PO is only for sites confirmed by email or WhatsApp approval.");
  return { original, latest: rows[0] };
}

export async function attachLateCustomerPo(
  c: PoolClient,
  options: { actor: string; actorName: string; record: { id: string; stage: string; data: any; customer_id: number }; requestKey: string; input: unknown },
) {
  const { actor, actorName, record: r } = options;
  const input = latePoSchema.parse(options.input);
  const { latest } = await latePoTarget(c, r);
  const file = (await c.query(
    "SELECT id,filename FROM project_workflow_files WHERE id=$1 AND record_id=$2 AND kind=$3",
    [input.fileId, r.id, latePoFileKind],
  )).rows[0];
  if (!file) throw new HttpError(422, "Upload the customer PO file for this site first.");
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`project-po:${r.customer_id}:${input.poNumber.toLowerCase()}`]);
  // Same rule as Confirm Sale: one customer PO number belongs to one site.
  const elsewhere = (await c.query(
    `SELECT 1 FROM project_po_receipts WHERE customer_id=$1 AND lower(reference)=lower($2) AND record_id<>$3
     UNION ALL SELECT 1 FROM project_late_customer_pos WHERE customer_id=$1 AND lower(po_number)=lower($2) AND record_id<>$3
     UNION ALL SELECT 1 FROM customer_purchase_orders p WHERE p.customer_id=$1 AND lower(p.po_number)=lower($2)
       AND NOT EXISTS(SELECT 1 FROM internal_purchase_orders i WHERE i.customer_po_id=p.id AND (i.id=$4 OR i.snapshot->>'workflowRecordId'=$3::text))
     LIMIT 1`,
    [r.customer_id, input.poNumber, r.id, r.data.ipoId],
  )).rowCount;
  if (elsewhere) throw new HttpError(409, "This customer PO number already belongs to another site.");
  const version = (await c.query(
    "SELECT COALESCE(max(version),0)+1 AS n FROM project_late_customer_pos WHERE record_id=$1",
    [r.id],
  )).rows[0].n as number;
  const ipoAmount = latest.total ? new Decimal(latest.total).toFixed(2) : null;
  const poAmount = input.poAmount ? new Decimal(input.poAmount).toFixed(2) : null;
  const amountDiffers = poAmount && ipoAmount ? !new Decimal(poAmount).eq(ipoAmount) : null;
  const id = randomUUID();
  const saved = (await c.query(
    "INSERT INTO project_late_customer_pos(id,record_id,ipo_id,customer_id,version,po_number,po_date,po_amount,ipo_amount,amount_differs,file_id,notes,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING created_at",
    [id, r.id, latest.id, r.customer_id, version, input.poNumber, input.poDate, poAmount, ipoAmount, amountDiffers, file.id, input.notes, options.requestKey, actor],
  )).rows[0];
  return {
    id, version, poNumber: input.poNumber, poDate: input.poDate, poAmount, ipoAmount, ipoNumber: latest.number,
    amountDiffers, fileId: file.id, filename: file.filename, notes: input.notes,
    at: new Date(saved.created_at).toISOString(), by: actor, byName: actorName,
  };
}

/** Latest received-later PO and the "PO to follow" flag for each workflow record, for list labels. */
export async function customerPoFollowUps(c: Db, recordIds: string[]) {
  const ids = [...new Set(recordIds.filter((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))];
  const result = new Map<string, { poToFollow: boolean; latePo: any }>();
  if (!ids.length) return result;
  const rows = (await c.query(
    `SELECT r.id,r.data->>'poToFollow' AS po_to_follow,p.version,p.po_number,p.po_date::text AS po_date,p.po_amount::text AS po_amount,p.ipo_amount::text AS ipo_amount,p.amount_differs,p.file_id,f.filename,p.created_at
     FROM project_workflow_records r
     LEFT JOIN LATERAL(SELECT * FROM project_late_customer_pos p WHERE p.record_id=r.id ORDER BY p.version DESC LIMIT 1)p ON true
     LEFT JOIN project_workflow_files f ON f.id=p.file_id
     WHERE r.id=ANY($1::uuid[])`,
    [ids],
  )).rows;
  for (const row of rows)
    result.set(row.id, {
      poToFollow: row.po_to_follow === "true",
      latePo: row.version ? {
        version: row.version, poNumber: row.po_number, poDate: row.po_date, poAmount: row.po_amount, ipoAmount: row.ipo_amount,
        amountDiffers: row.amount_differs, fileId: row.file_id, filename: row.filename, at: new Date(row.created_at).toISOString(),
      } : null,
    });
  return result;
}

const uuidText = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Latest customer PO attached later, by IPO id (the original IPO and any revision of the same site).
 * The issued IPO keeps the PO it was issued on; Operations, Store and Accounts treat this attached PO as current.
 */
export async function attachedPoByIpo(c: Db, ipoIds: unknown[]) {
  const ids = [...new Set(ipoIds.filter((id): id is string => typeof id === "string" && uuidText.test(id)))];
  const result = new Map<string, string>();
  if (!ids.length) return result;
  const rows = (await c.query(
    `SELECT q.id AS ipo_id,l.po_number FROM internal_purchase_orders q
     JOIN LATERAL(SELECT p.po_number FROM project_late_customer_pos p
       WHERE p.record_id=COALESCE((SELECT i.record_id FROM project_workflow_issuances i WHERE i.ipo_id=q.id),
         CASE WHEN q.snapshot->>'workflowRecordId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (q.snapshot->>'workflowRecordId')::uuid END)
       ORDER BY p.version DESC LIMIT 1)l ON true
     WHERE q.id=ANY($1::uuid[])`,
    [ids],
  )).rows;
  for (const row of rows) result.set(row.ipo_id, row.po_number);
  return result;
}

/**
 * When Coordination attaches a customer PO, the site's Operations Board record gets a new version showing that PO,
 * so Operations, Store documents and Accounts invoice details use it. Earlier board versions stay unchanged.
 */
export async function recordAttachedPoOnBoard(c: PoolClient, actor: string, recordId: string, saved: { poNumber: string; version: number }) {
  const ipoIds = (await c.query(
    `SELECT i.ipo_id::text AS id FROM project_workflow_issuances i WHERE i.record_id=$1
     UNION SELECT q.id::text FROM internal_purchase_orders q WHERE q.snapshot->>'workflowRecordId'=$1::text`,
    [recordId],
  )).rows.map((r) => r.id as string);
  if (!ipoIds.length) return [];
  const siteIds = (await c.query(
    `SELECT DISTINCT site_id FROM (
       SELECT DISTINCT ON(site_id) site_id,snapshot FROM operations_board_versions ORDER BY site_id,version DESC) b
     WHERE b.snapshot#>>'{origin,ipoId}'=ANY($1::text[])
       OR b.site_id IN(SELECT board_site_id FROM inventory_material_source_links WHERE ipo_id::text=ANY($1::text[]))
     ORDER BY site_id`,
    [ipoIds],
  )).rows.map((r) => r.site_id as string);
  const updated: { siteId: string; version: number }[] = [];
  for (const siteId of siteIds) {
    await c.query("SELECT id FROM operations_board_sites WHERE id=$1 FOR UPDATE", [siteId]);
    const row = (await c.query("SELECT version,snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1", [siteId])).rows[0];
    if (!row || String(row.snapshot.customerPo ?? "").trim().toLowerCase() === saved.poNumber.trim().toLowerCase()) continue;
    const description = `Customer PO ${saved.poNumber} attached by Coordination (version ${saved.version}); previously ${row.snapshot.customerPo || "not recorded"}.`;
    const snapshot = { ...row.snapshot, customerPo: saved.poNumber, history: [...(row.snapshot.history ?? []), { date: new Date().toISOString().slice(0, 10), description }] };
    const version = row.version + 1;
    await c.query(
      "INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [siteId, version, snapshot, "Customer PO updated", description, randomUUID(), actor],
    );
    await c.query(
      "INSERT INTO operations_board_events(id,site_id,site_version,kind,audiences,created_by) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(), siteId, version, "Customer PO updated", JSON.stringify(["accounts", "operations-head"]), actor],
    );
    await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [actor, `operations.board.customer-po:${siteId}:${version}`]);
    updated.push({ siteId, version });
  }
  return updated;
}
