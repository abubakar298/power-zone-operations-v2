import { Decimal } from "decimal.js";
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HttpError } from "../http/errors.js";

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
  if (!approvalTypes.includes(original.evidence_type))
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
