import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {Decimal} from 'decimal.js';
import {z} from 'zod';
import {transaction} from '../db/transaction.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {HttpError} from '../http/errors.js';
import {materialDocumentPolicy} from '../../shared/material-documents.js';
import {fixedPreparationRows} from '../../shared/material-preparation.js';
import type {SiteMaterialPlanRepository} from './site-material-plans.js';
import type {MaterialStockRepository} from './material-stock.js';

export const savedSiteIssueSchema=z.object({version:z.number().int().positive(),requestKey:z.uuid(),partialDelivery:z.boolean(),note:z.string().trim().min(3).max(2000)}).strict();
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function combinedId(planId:string){const hex=createHash('sha256').update('inventory.site.combined:'+planId).digest('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;}

/** Printed and dispatched quantities come from the saved preparation. Fixed and
 * variable modules retain their original IDs; the physical DO is one immutable
 * warehouse record, whose signed gate copy uses the existing posting command. */
export async function issueSavedSite(pool:Pool,plans:SiteMaterialPlanRepository,stock:MaterialStockRepository,actor:string,planId:string,raw:unknown){
 const input=savedSiteIssueSchema.parse(raw),requestFingerprint=digest({planId,...input});
 const plan=await plans.detail(actor,planId);
 const replay=(await pool.query('SELECT id,number,created_by,snapshot FROM inventory_material_dispatches WHERE request_key=$1',[input.requestKey])).rows[0];
 if(replay){if(replay.created_by!==actor||replay.snapshot.combinedPlan?.requestFingerprint!==requestFingerprint)throw new HttpError(409,'This request belongs to another issuance.');const existing=await stock.dispatch(actor,replay.id);return {id:replay.id,number:replay.number,stockPosted:existing.stockPosted};}
 if(plan.version!==input.version)throw new HttpError(409,'This preparation changed. Refresh before saving its DO.');
 const draftId=combinedId(planId),position=await stock.positions(actor,plan.fixed.snapshot.warehouse);
 if(!position.authority||position.authority.state!=='active')throw new HttpError(409,'This warehouse balance needs verification before material can be issued.');
 const prepared=await transaction(pool,async c=>{
  await lockActiveActor(c,actor);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.site.issue.'||$1,0))",[planId]);
  const current=(await c.query('SELECT version FROM inventory_site_material_plan_versions WHERE plan_id=$1 ORDER BY version DESC LIMIT 1',[planId])).rows[0];
  if(current?.version!==input.version)throw new HttpError(409,'This preparation changed. Refresh before issuing.');
  const fixed=plan.fixed.snapshot,variable=plan.variableSupply==='single-site'?plan.variable?.snapshot:null;
  const source=fixed.sites[0];
  const catalogue=(await plans.materialCatalogue(actor)).catalogue;
  const approved=fixedPreparationRows(source,catalogue,()=>'',{}).filter(r=>r.out!==''&&!materialDocumentPolicy(r).approvedQuantityLocked);
  if(!input.partialDelivery)for(const basis of approved){const entered=fixed.lines.filter((r:any)=>basis.basisLine!==undefined?r.basisLine===basis.basisLine:r.itemId===basis.itemId).reduce((sum:Decimal,r:any)=>sum.plus(r.out||0),new Decimal(0));if(entered.lt(basis.out))throw new HttpError(422,'Fixed items are below the approved BOQ. Select Partial delivery to save a reduced fixed-item issuance.');}
  const moduleIds=[plan.fixed.id,...(variable?[plan.variable!.id]:[])];
  const prior=(await c.query('SELECT l.line_key,sum(l.quantity)::text quantity FROM inventory_material_dispatch_lines l JOIN inventory_material_dispatches d ON d.id=l.dispatch_id WHERE d.draft_id=ANY($1::uuid[]) GROUP BY l.line_key',[moduleIds])).rows;
  const rows=[...fixed.lines,...(variable?.lines??[])].filter((r:any)=>r.itemId&&r.out!==''&&new Decimal(r.out).gt(0)&&!materialDocumentPolicy(r).approvedQuantityLocked&&materialDocumentPolicy(r).group!=='non-stock').map((r:any)=>({...r,out:new Decimal(r.out).minus(prior.find(p=>p.line_key===r.key)?.quantity??0).toString()}));
  if(rows.some(r=>new Decimal(r.out).lt(0)))throw new HttpError(409,'A saved quantity is lower than material already dispatched. Review its original DO.');
  const previous=(await c.query('SELECT version,snapshot FROM inventory_material_draft_versions WHERE draft_id=$1 ORDER BY version DESC LIMIT 1',[draftId])).rows[0];
  const dispatched=(await c.query('SELECT l.line_key,l.item_id,l.unit,l.description,sum(l.quantity)::text quantity FROM inventory_material_dispatch_lines l JOIN inventory_material_dispatches d ON d.id=l.dispatch_id WHERE d.draft_id=$1 GROUP BY l.line_key,l.item_id,l.unit,l.description',[draftId])).rows;
  for(const sent of dispatched){const row=rows.find(r=>r.key===sent.line_key);if(!row||row.itemId!==sent.item_id||row.unit!==sent.unit||row.description!==sent.description||new Decimal(row.out).lt(sent.quantity))throw new HttpError(409,'Previously issued rows must retain their item, unit and dispatched quantity. Review the saved DO before revising.');}
  const lines=rows.filter(r=>new Decimal(r.out).gt(0)).map(r=>{const remaining=new Decimal(r.out).minus(dispatched.find(d=>d.line_key===r.key)?.quantity??0);const balance=position.positions.find(p=>p.itemId===r.itemId&&p.unit===r.unit);if(remaining.gt(0)&&!balance)throw new HttpError(409,'An entered item has no reviewed warehouse balance.');return {lineKey:r.key,quantity:remaining.toString(),ledgerRevision:balance?.ledgerRevision??0};}).filter(r=>new Decimal(r.quantity).gt(0));
  if(!lines.length)throw new HttpError(409,'The entered quantities already have a DO. Open Preview Documents to download it.');
  const retry=(await c.query('SELECT version,snapshot FROM inventory_material_draft_versions WHERE draft_id=$1 AND request_key=$2',[draftId,input.requestKey])).rows[0];
  if(retry){if(retry.snapshot.combinedPlan?.requestFingerprint!==requestFingerprint)throw new HttpError(409,'This request belongs to another issuance.');return {version:retry.version,lines,warehouse:fixed.warehouse,transport:fixed.transport};}
  const version=(previous?.version??0)+1;
  const snapshot={...fixed,lines:rows,kind:'fixed',parent:false,combinedPlan:{id:planId,version:input.version,fixedDraftId:plan.fixed.id,variableDraftId:variable?plan.variable!.id:null,requestFingerprint},partialDelivery:input.partialDelivery};
  if(!previous)await c.query('INSERT INTO inventory_material_drafts(id,created_by) VALUES($1,$2)',[draftId,actor]);
  await c.query('INSERT INTO inventory_material_draft_versions(draft_id,version,snapshot,request_key,request_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6)',[draftId,version,snapshot,input.requestKey,digest(snapshot),actor]);
  return {version,lines,warehouse:fixed.warehouse,transport:fixed.transport};
 });
 return stock.issue(actor,{draftId,version:prepared.version,requestKey:input.requestKey,sourceSha256:position.authority.source_sha256,authorityVersion:position.authority.version,reason:input.note,transport:prepared.transport,lines:prepared.lines},true);
}

export async function issueSavedParent(pool:Pool,repo:import('./material-drafts.js').MaterialDraftRepository,stock:MaterialStockRepository,actor:string,id:string,raw:unknown){
 const input=savedSiteIssueSchema.omit({partialDelivery:true}).parse(raw),draft=await repo.detail(actor,id);
 if(!draft.snapshot.parent||draft.snapshot.kind!=='variable')throw new HttpError(422,'Select a Parent DO preparation.');
 if(draft.version!==input.version)throw new HttpError(409,'This Parent DO changed. Refresh before saving.');
 const replay=(await pool.query('SELECT id,number,draft_id,draft_version,created_by FROM inventory_material_dispatches WHERE request_key=$1',[input.requestKey])).rows[0];
 if(replay){if(replay.created_by!==actor||replay.draft_id!==id||replay.draft_version!==input.version)throw new HttpError(409,'This request belongs to another Parent DO.');const d=await stock.dispatch(actor,replay.id);if(d.snapshot.reason!==input.note)throw new HttpError(409,'This request belongs to another Parent DO.');return {id:d.id,number:d.number,stockPosted:d.stockPosted};}
 const [position,movements]=await Promise.all([stock.positions(actor,draft.snapshot.warehouse),stock.movements(actor,id)]);
 if(!position.authority||position.authority.state!=='active')throw new HttpError(409,'Verify this warehouse balance before issuing material.');
 const lines=draft.snapshot.lines.filter((r:any)=>r.itemId&&r.out!==''&&new Decimal(r.out).gt(0)).map((r:any)=>{const prior=movements.lines.find(l=>l.line_key===r.key),balance=position.positions.find(p=>p.itemId===r.itemId&&p.unit===r.unit),quantity=new Decimal(r.out).minus(prior?.prepared??0);if(quantity.gt(0)&&!balance)throw new HttpError(409,'An entered item has no reviewed warehouse balance.');return {lineKey:r.key,quantity:quantity.toString(),ledgerRevision:balance?.ledgerRevision??0};}).filter((r:any)=>new Decimal(r.quantity).gt(0));
 if(!lines.length){const latest=movements.dispatches.at(-1);if(latest){const d=await stock.dispatch(actor,latest.id);return {id:d.id,number:d.number,stockPosted:d.stockPosted};}throw new HttpError(422,'Enter a quantity for the material being issued.');}
 return stock.issue(actor,{draftId:id,version:input.version,requestKey:input.requestKey,sourceSha256:position.authority.source_sha256,authorityVersion:position.authority.version,transport:draft.snapshot.transport,reason:input.note,lines});
}
