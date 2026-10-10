import type { Pool, PoolClient } from "pg";
import { HttpError } from "../http/errors.js";

export async function quotationEligibility(c: Pool | PoolClient, id: string) {
  const row=(await c.query(`SELECT q.id,
    (SELECT e.kind FROM coordination_events e WHERE e.quotation_id=q.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1) AS status,
    NOT EXISTS(SELECT 1 FROM quotation_versions n WHERE n.boq_revision_id=q.boq_revision_id AND n.version>q.version) AS current,
    EXISTS(SELECT 1 FROM quotation_revision_requests r WHERE r.source_quotation_id=q.id) AS revision_requested
    FROM quotation_versions q WHERE q.id=$1`,[id])).rows[0];
  if(!row) throw new HttpError(404,"Saved quotation not found.");
  const approved=["Approved","PO received"].includes(row.status);
  const reason=!approved?"Management approval is required for this exact quotation version.":row.revision_requested?"This quotation has a revision request. Use the approved revised version.":!row.current?"This quotation is superseded. Select the current approved version.":null;
  return {...row,approved,eligible:reason===null,reason};
}
export async function requireEligibleQuotation(c: Pool | PoolClient,id:string) {
  const state=await quotationEligibility(c,id);
  if(!state.eligible) throw new HttpError(409,state.reason!);
  return state;
}
