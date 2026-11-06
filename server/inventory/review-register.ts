import {lockActiveActor} from '../auth/actor-lock.js';
import {createHash, randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Pool, PoolClient} from 'pg';
import {z} from 'zod';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';
import {prepareInventoryReview} from './review-source.js';
import {reviewQuantities} from './review-quantities.js';
import {WarehouseSourceRepository} from './warehouse-register.js';
import {Decimal} from 'decimal.js';

const evidence = z.array(z.object({reference:z.string().trim().min(1).max(1000),description:z.string().trim().min(1).max(2000)}).strict()).min(1).max(30);
const proposalSchema=z.object({
 treatment:z.enum(['correct-source-record','verify-return','investigate-shortage','resolve-identity','other']),
 explanation:z.string().trim().min(1).max(4000),evidence,
 returnCorrection:z.object({sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),ledgerKey:z.string().regex(/^[a-f0-9]{64}$/),ledgerRevision:z.number().int().nonnegative(),inDelta:z.string().regex(/^-?\d{1,14}(?:\.\d{1,6})?$/)}).strict().optional(),
 // Only this bounded, source-linked return plan can affect the warehouse
 // reconciliation projection after assigned Management approval.
}).strict();
export const reviewCommandSchema=z.object({
 version:z.number().int().positive(),requestKey:z.uuid(),
 action:z.enum(['propose','return-for-clarification','approve']),
 reason:z.string().trim().min(1).max(4000),proposal:proposalSchema.optional(),
}).strict().superRefine((v,c)=>{if((v.action==='propose')!==!!v.proposal)c.addIssue({code:'custom',path:['proposal'],message:'Only a new proposal supplies proposal details.'});});
type Prepared=ReturnType<typeof prepareInventoryReview>;
type Access={reviewer:boolean;approver:boolean;importer:boolean};
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const latest=`SELECT c.id,c.source_row,v.version,v.state,v.proposal,v.reason,v.created_by,v.created_at,
 (SELECT in_delta::text FROM inventory_warehouse_return_corrections WHERE case_id=c.id) AS approved_return_delta
 FROM inventory_review_cases c JOIN LATERAL
 (SELECT * FROM inventory_review_versions WHERE case_id=c.id ORDER BY version DESC LIMIT 1) v ON true`;

/** Append-only decisions. Source-linked return corrections require owner approval;
 * historical events and legacy Procurement counts are never rewritten. */
export class InventoryReviewRepository{
 constructor(private pool:Pool){}
 private async access(actor:string,c:Pool|PoolClient=this.pool):Promise<Access>{
  const user=(await c.query(`SELECT u.active,u.role,
   EXISTS(SELECT 1 FROM inventory_review_access a WHERE a.user_id=u.id AND a.capability='reviewer') AS reviewer,
   EXISTS(SELECT 1 FROM inventory_review_access a WHERE a.user_id=u.id AND a.capability='approver') AS approver
   FROM users u WHERE u.id=$1`,[actor])).rows[0];
  if(!user?.active)throw new HttpError(401,'Your access has ended.');
  const approver=user.approver&&['Admin','Management'].includes(user.role);
  const reviewer=user.reviewer&&user.role==='Inventory';
  const importer=['Admin','Management'].includes(user.role);
  if(!reviewer&&!approver&&!importer)throw new HttpError(403,'Inventory reconciliation access is not assigned.');
  return {reviewer,approver,importer};
 }
 /** Operator-only: source payload is recomputed, never accepted from a browser. */
 async importSource(actor:string,input:{sourceSha256:string;catalogueSha256:string;source:unknown;catalogue:unknown}){
  const a=await this.access(actor);if(!a.importer)throw new HttpError(403,'Management must import reviewed source evidence.');
  z.string().regex(/^[a-f0-9]{64}$/).parse(input.sourceSha256);z.string().regex(/^[a-f0-9]{64}$/).parse(input.catalogueSha256);
  const prepared=prepareInventoryReview(input.source,input.catalogue);
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   if(!(await this.access(actor,c)).importer)throw new HttpError(403,'Management must import reviewed source evidence.');
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.review.import',0))");
   const metadata={groups:prepared.groups,summary:prepared.summary,contentFingerprint:fingerprint(prepared)};
   const old=(await c.query('SELECT catalogue_sha256,metadata FROM inventory_review_sources WHERE source_sha256=$1',[input.sourceSha256])).rows[0];
   if(old&&(old.catalogue_sha256!==input.catalogueSha256||!isDeepStrictEqual(old.metadata,metadata)))throw new HttpError(409,'This source fingerprint is already attached to different evidence.');
   if(!old)await c.query('INSERT INTO inventory_review_sources(source_sha256,catalogue_sha256,metadata,created_by) VALUES($1,$2,$3,$4)',[input.sourceSha256,input.catalogueSha256,metadata,actor]);
   let imported=0,retained=0;
   for(const row of prepared.cases){
    const existing=(await c.query('SELECT source_row FROM inventory_review_cases WHERE id=$1',[row.id])).rows[0];
    if(existing){if(!isDeepStrictEqual(existing.source_row,row))throw new HttpError(409,'A reconciliation row changed. Review the source revision instead of overwriting it.');retained++;continue;}
    await c.query('INSERT INTO inventory_review_cases(id,source_sha256,source_row) VALUES($1,$2,$3)',[row.id,input.sourceSha256,row]);
    await c.query(`INSERT INTO inventory_review_versions(case_id,version,state,proposal,reason,request_key,request_fingerprint,created_by)
     VALUES($1,1,$2,NULL,$3,$4,$5,$6)`,[row.id,row.conclusion==='verified-source'?'source-verified':'needs-review','Reviewed source imported; existing stock entries were not replayed.',randomUUID(),fingerprint(row),actor]);imported++;
   }
   return {imported,retained,stockPosted:0};
  });
 }
 async list(actor:string){
  const access=await this.access(actor),rows=(await this.pool.query(latest+' ORDER BY c.id')).rows;
  return {access,postingEnabled:true,rows:rows.map(row=>({...row,source_row:reviewQuantities(row.source_row,row.approved_return_delta??'0')}))};
 }
 async detail(actor:string,id:string){
  const access=await this.access(actor),row=(await this.pool.query(latest+' WHERE c.id=$1',[id])).rows[0];
  if(!row)throw new HttpError(404,'Reconciliation item not found.');
  const history=(await this.pool.query('SELECT version,state,proposal,reason,created_by,created_at FROM inventory_review_versions WHERE case_id=$1 ORDER BY version DESC',[id])).rows;
  const closing=await new WarehouseSourceRepository(this.pool).caseClosing(id,row.source_row);
  return {access,postingEnabled:true,...row,source_row:reviewQuantities(row.source_row,row.approved_return_delta??'0'),closing,history};
 }
 async command(actor:string,id:string,input:z.infer<typeof reviewCommandSchema>){
 const v=reviewCommandSchema.parse(input);
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   const access=await this.access(actor,c);
   if(v.action==='propose'?!access.reviewer:!access.approver)throw new HttpError(403,v.action==='propose'?'Only the assigned Inventory reviewer can propose a decision.':'Only the assigned Management approver can decide.');
   const found=(await c.query('SELECT source_row FROM inventory_review_cases WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!found)throw new HttpError(404,'Reconciliation item not found.');
   const hash=fingerprint(v),prior=(await c.query('SELECT version,state,request_fingerprint,created_by FROM inventory_review_versions WHERE case_id=$1 AND request_key=$2',[id,v.requestKey])).rows[0];
   if(prior){if(prior.request_fingerprint!==hash||prior.created_by!==actor)throw new HttpError(409,'This request key was already used for another decision.');return {version:prior.version,state:prior.state,stockPosted:0};}
   const current=(await c.query('SELECT * FROM inventory_review_versions WHERE case_id=$1 ORDER BY version DESC LIMIT 1',[id])).rows[0];
   if(current.version!==v.version)throw new HttpError(409,'This item changed. Refresh before deciding.');
   if(current.state==='source-verified')throw new HttpError(409,'This conclusion was already verified. It is not in the decision queue.');
   if(v.action==='propose'&&!['needs-review','clarification'].includes(current.state))throw new HttpError(409,'Return the existing proposal for clarification before replacing it.');
   if(v.action!=='propose'&&current.state!=='proposed'&&!(v.action==='return-for-clarification'&&current.state==='approved-awaiting-posting'))throw new HttpError(409,'An Inventory proposal is required first.');
   const row=found.source_row as Prepared['cases'][number];
   if(v.action==='approve'&&row.identityReviewRequired)throw new HttpError(409,'Resolve the final item identity with reviewed source evidence before approval.');
   const proposal=v.proposal??current.proposal;
   const correction=proposal?.returnCorrection;
   let closing:Awaited<ReturnType<WarehouseSourceRepository['caseClosing']>>|undefined;
   if(correction&&v.action!=='return-for-clarification'){
    if(proposal.treatment!=='verify-return')throw new HttpError(422,'Return-credit corrections require the verify-return treatment.');
    // Lock the shared item/warehouse/unit baseline, not merely this pool row.
    // Another pool can affect the same closing balance at the same time.
    await c.query('SELECT ledger_key FROM inventory_warehouse_source_balances WHERE source_sha256=$1 AND ledger_key=$2 FOR UPDATE',[correction.sourceSha256,correction.ledgerKey]);
    closing=await new WarehouseSourceRepository(this.pool).caseClosing(id,row,c);
    if(!closing.available||closing.holds.length||row.identityReviewRequired||!closing.suggestedReturnCorrection||closing.currentClosing===null)throw new HttpError(409,'Complete the item, warehouse, unit, usage and return evidence before a stock correction.');
    const expected=closing.suggestedReturnCorrection.inDelta;
    if(new Decimal(closing.currentClosing).decimalPlaces()>6||new Decimal(closing.currentClosing).abs().gte('100000000000000'))throw new HttpError(409,'Warehouse quantity precision needs verification before posting.');
    if(closing.caseCorrectionPosted||new Decimal(expected).isZero()||!new Decimal(expected).equals(correction.inDelta))throw new HttpError(409,'The proposed return credit does not match the remaining recorded difference.');
    if(closing.sourceSha256!==correction.sourceSha256||closing.ledgerKey!==correction.ledgerKey||closing.ledgerRevision!==correction.ledgerRevision)throw new HttpError(409,'The warehouse closing balance changed. Return for clarification and prepare a fresh proposal.');
   }
   const posts=v.action==='approve'&&!!correction;
   const state=v.action==='propose'?'proposed':v.action==='approve'?(posts?'posted':'approved-awaiting-posting'):'clarification';
   await c.query(`INSERT INTO inventory_review_versions(case_id,version,state,proposal,reason,request_key,request_fingerprint,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,v.version+1,state,proposal,v.reason,v.requestKey,hash,actor]);
   if(posts&&closing?.available){
    await c.query(`INSERT INTO inventory_warehouse_return_corrections(case_id,approval_version,source_sha256,ledger_key,ledger_revision,in_delta,closing_before,closing_after,approved_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,v.version+1,closing.sourceSha256,closing.ledgerKey,closing.ledgerRevision+1,correction.inDelta,closing.currentClosing,closing.suggestedReturnCorrection!.after,actor]);
   }
   return {version:v.version+1,state,stockPosted:posts?1:0};
  });
 }
}
