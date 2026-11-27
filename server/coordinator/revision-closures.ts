import type {Pool} from 'pg';
import {z} from 'zod';
import {transaction} from '../db/transaction.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {HttpError} from '../http/errors.js';

export const closeRevisionSchema=z.object({reason:z.string().trim().min(5).max(2000),requestKey:z.uuid()}).strict();
/** Close a quotation revision request resolved outside the portal (user request, 25 Nov 2026). Nothing is deleted:
 * the request stays in history and quotation_revision_requests_current stops listing it, so it leaves the
 * Revisions tab and its quotation returns to its normal step. Refused when the revision is already under way in a
 * way other people rely on (a revised quotation, an IPO revision, or a BOQ waiting for Design's review). */
export async function closeRevisionRequest(pool:Pool,actor:string,requestId:string,raw:unknown){
 const input=closeRevisionSchema.parse(raw);
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);
  const user=(await c.query('SELECT role FROM users WHERE id=$1 AND active',[actor])).rows[0];
  if(!user||!['Admin','Management','Coordinator'].includes(user.role))throw new HttpError(403,'Only Coordination or Management can close a revision.');
  const replay=(await c.query('SELECT request_id,reason,closed_at FROM quotation_revision_closures WHERE request_key=$1',[input.requestKey])).rows[0];
  if(replay){if(replay.request_id!==requestId)throw new HttpError(409,'This request key belongs to another revision.');return replay;}
  const r=(await c.query('SELECT r.id,r.created_by,r.draft_id,q.number,q.created_by AS quotation_owner,d.owner_id AS draft_owner FROM quotation_revision_requests_current r JOIN quotation_versions q ON q.id=r.source_quotation_id LEFT JOIN survey_drafts d ON d.id=r.draft_id WHERE r.id=$1',[requestId])).rows[0];
  if(!r)throw new HttpError(404,'This revision is not open. Refresh the Revisions list.');
  await c.query('SELECT id FROM quotation_revision_requests WHERE id=$1 FOR UPDATE',[requestId]);
  if(user.role==='Coordinator'&&![r.created_by,r.draft_owner,r.quotation_owner].includes(actor))throw new HttpError(403,'Only the coordinator of this revision, or Management, can close it.');
  if((await c.query('SELECT 1 FROM quotation_revision_links WHERE request_id=$1',[requestId])).rowCount)throw new HttpError(409,'This revision already produced a revised quotation, so it cannot be closed here.');
  if((await c.query('SELECT 1 FROM ipo_revision_requests WHERE quotation_revision_request_id=$1',[requestId])).rowCount)throw new HttpError(409,'This revision belongs to an IPO revision. Finish or return it from the IPO revision instead.');
  if(r.draft_id&&(await c.query('SELECT 1 FROM boq_review_submissions s WHERE s.draft_id=$1 AND NOT EXISTS(SELECT 1 FROM boq_review_decisions v WHERE v.submission_id=s.id)',[r.draft_id])).rowCount)throw new HttpError(409,'A BOQ for this revision is waiting for Design review. Ask Design to decide it first.');
  const closed=(await c.query('INSERT INTO quotation_revision_closures(request_id,reason,closed_by,request_key) VALUES($1,$2,$3,$4) RETURNING request_id,reason,closed_at',[requestId,input.reason,actor,input.requestKey])).rows[0];
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'quotation.revision-request.closed:'+JSON.stringify({requestId,quotation:r.number,reason:input.reason})]);
  return closed;
 });
}
