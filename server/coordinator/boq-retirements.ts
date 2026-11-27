import type {Pool} from 'pg';
import {z} from 'zod';
import {transaction} from '../db/transaction.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {HttpError} from '../http/errors.js';

export const retireBoqSchema=z.object({reason:z.string().trim().min(5).max(2000),requestKey:z.uuid()}).strict();
/** "Not needed" for an approved BOQ that will never be priced, e.g. a Quick BOQ made before a full survey of the same
 * site (user decision, 27 Nov 2026). Nothing is deleted: boq_retirements records the reason, and the BOQ leaves
 * Design Review ("Approved BOQ: prepare pricing"). Refused once the BOQ is in use: a newer revision, pricing, an IPO,
 * or a link from a project workflow record. */
export async function retireBoqRevision(pool:Pool,actor:string,revisionId:string,raw:unknown){
 const input=retireBoqSchema.parse(raw);
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);
  const user=(await c.query('SELECT role FROM users WHERE id=$1 AND active',[actor])).rows[0];
  if(!user||!['Admin','Management','Coordinator'].includes(user.role))throw new HttpError(403,'Only Coordination or Management can mark a BOQ as not needed.');
  const replay=(await c.query('SELECT revision_id,reason,retired_at FROM boq_retirements WHERE request_key=$1',[input.requestKey])).rows[0];
  if(replay){if(replay.revision_id!==revisionId)throw new HttpError(409,'This request key belongs to another BOQ.');return replay;}
  const b=(await c.query('SELECT r.id,r.boq_id,r.revision,r.number,f.created_by,d.owner_id AS draft_owner FROM boq_revisions r JOIN boqs f ON f.id=r.boq_id LEFT JOIN boq_draft_finalizations x ON x.revision_id=r.id LEFT JOIN survey_drafts d ON d.id=x.draft_id WHERE r.id=$1 FOR UPDATE OF r',[revisionId])).rows[0];
  if(!b)throw new HttpError(404,'BOQ not found.');
  if(user.role==='Coordinator'&&![b.created_by,b.draft_owner].includes(actor))throw new HttpError(403,'Only the coordinator of this BOQ, or Management, can mark it as not needed.');
  if((await c.query('SELECT 1 FROM boq_retirements WHERE revision_id=$1',[revisionId])).rowCount)throw new HttpError(409,'This BOQ is already marked as not needed.');
  if((await c.query('SELECT 1 FROM boq_revisions WHERE boq_id=$1 AND revision>$2',[b.boq_id,b.revision])).rowCount)throw new HttpError(409,'A newer revision of this BOQ exists, so it is not waiting for pricing.');
  if((await c.query('SELECT 1 FROM commercial_pricing_versions WHERE boq_revision_id=$1',[revisionId])).rowCount)throw new HttpError(409,'This BOQ already has pricing, so it cannot be marked as not needed.');
  if((await c.query("SELECT 1 FROM internal_purchase_orders WHERE snapshot->>'boqRevisionId'=$1::text",[revisionId])).rowCount)throw new HttpError(409,'This BOQ is used by an IPO, so it cannot be marked as not needed.');
  if((await c.query("SELECT 1 FROM project_workflow_records WHERE data->>'linkedBoqRevisionId'=$1::text OR data->>'designLinkedBoqRevisionId'=$1::text",[revisionId])).rowCount)throw new HttpError(409,'This BOQ belongs to a site in the workflow. Continue it from that site instead.');
  const retired=(await c.query('INSERT INTO boq_retirements(revision_id,reason,retired_by,request_key) VALUES($1,$2,$3,$4) RETURNING revision_id,reason,retired_at',[revisionId,input.reason,actor,input.requestKey])).rows[0];
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'boq.retired:'+JSON.stringify({revisionId,boq:b.number,reason:input.reason})]);
  return retired;
 });
}
