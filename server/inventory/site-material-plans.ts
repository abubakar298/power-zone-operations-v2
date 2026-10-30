import {Decimal} from 'decimal.js';
import {materialDocumentPolicy} from '../../shared/material-documents.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {HttpError} from '../http/errors.js';
import {transaction} from '../db/transaction.js';
import {MaterialDraftRepository,materialDraftInputSchema} from './material-drafts.js';

const shape=materialDraftInputSchema.shape;
export const siteMaterialPlanInputSchema=z.object({
 id:z.uuid().optional(),version:z.number().int().nonnegative(),requestKey:z.uuid(),
 warehouse:shape.warehouse,source:shape.sites.element,transport:shape.transport,
 fixedLines:shape.lines,variableLines:shape.lines,
 revisionReason:shape.revisionReason,
 variableSupply:z.enum(['single-site','parent-do']),
}).strict();
export type SiteMaterialPlanInput=z.infer<typeof siteMaterialPlanInputSchema>;
const latest=`SELECT p.id,v.* FROM inventory_site_material_plans p JOIN LATERAL
 (SELECT * FROM inventory_site_material_plan_versions WHERE plan_id=p.id ORDER BY version DESC LIMIT 1)v ON true`;
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Independent namespaces retain exactly-once draft saves inside the same
// transaction; no client-supplied internal draft ID can attach another plan.
function childRequest(key:string,kind:string){const h=fingerprint({key,kind});return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}

/** Preparation only. A Parent DO checkbox records the intended supply route;
 * it never creates a second dispatch or requires invented variable quantities. */
export class SiteMaterialPlanRepository{
 private drafts:MaterialDraftRepository;
 constructor(private pool:Pool){this.drafts=new MaterialDraftRepository(pool);}
 private async read(actor:string,id:string,c:Pool|PoolClient){
  const row=(await c.query(latest+' WHERE p.id=$1',[id])).rows[0];
  if(!row)throw new HttpError(404,'Site material preparation not found.');
  const fixed=await this.drafts.detail(actor,row.fixed_draft_id,c),variable=row.variable_draft_id?await this.drafts.detail(actor,row.variable_draft_id,c):null;
  // These draft IDs belong solely to this plan. If another path ever appended
  // a version, require a refresh/review instead of silently losing that work.
  if(fixed.version!==row.fixed_draft_version||(variable&&variable.version!==row.variable_draft_version))throw new HttpError(409,'A material module changed separately. Review its saved draft before continuing.');
  return {id:row.id,version:row.version,variableSupply:row.variable_supply,fixed,variable,createdAt:row.created_at,stockPosting:false as const};
 }
 async issued(actor:string,id:string){
  const plan=await this.detail(actor,id),ids=[plan.fixed.id,...(plan.variable?[plan.variable.id]:[])];
  const rows=(await this.pool.query("SELECT id,number,snapshot,created_at FROM inventory_material_dispatches WHERE draft_id=ANY($1::uuid[]) OR snapshot#>>'{combinedPlan,id}'=$2 ORDER BY created_at DESC,id",[ids,id])).rows;
  return {dispatches:rows.map(r=>({id:r.id,number:r.number,createdAt:r.created_at,lines:r.snapshot.lines.map((l:any)=>({key:l.key,itemId:l.itemId,unit:l.unit,quantity:l.out})),variable:r.snapshot.lines.some((l:any)=>l.out&&Number(l.out)>0&&materialDocumentPolicy(l).customerUsageSignoff)}))};
 }
 async materialCatalogue(actor:string){return this.drafts.catalogue(actor);}
 async issueSaved(actor:string,id:string,input:unknown,stock:import('./material-stock.js').MaterialStockRepository){const {issueSavedSite}=await import('./site-material-issuance.js');return issueSavedSite(this.pool,this,stock,actor,id,input);}
 async detail(actor:string,id:string){return this.read(actor,id,this.pool);}
 async list(actor:string){
  const permitted=await this.drafts.list(actor),ids=new Set(permitted.drafts.map(r=>r.id));
  const rows=(await this.pool.query(latest+' ORDER BY v.created_at DESC')).rows;
  return {plans:rows.filter(r=>ids.has(r.fixed_draft_id)&&(!r.variable_draft_id||ids.has(r.variable_draft_id))).map(r=>({id:r.id,version:r.version,variableSupply:r.variable_supply,fixedDraftId:r.fixed_draft_id,variableDraftId:r.variable_draft_id,siteId:permitted.drafts.find(d=>d.id===r.fixed_draft_id)?.snapshot.sites[0]?.siteId,createdAt:r.created_at})),stockPosting:false as const};
 }
 async save(actor:string,raw:SiteMaterialPlanInput){
  const input=siteMaterialPlanInputSchema.parse(raw);
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.site.material.request.'||$1,0))",[input.requestKey]);
   const replay=(await c.query('SELECT plan_id,version,request_fingerprint,created_by FROM inventory_site_material_plan_versions WHERE request_key=$1',[input.requestKey])).rows[0];
   if(replay){
    await this.read(actor,replay.plan_id,c);
    if(replay.created_by!==actor||replay.request_fingerprint!==fingerprint(input))throw new HttpError(409,'This request belongs to a different saved material preparation.');
    return {id:replay.plan_id,version:replay.version,stockPosting:false as const};
   }
   const id=input.id??randomUUID();
   let existing:Awaited<ReturnType<SiteMaterialPlanRepository['read']>>|undefined;
   if(input.id){
    await c.query('SELECT id FROM inventory_site_material_plans WHERE id=$1 FOR UPDATE',[id]);
    existing=await this.read(actor,id,c);
    if(existing.version!==input.version)throw new HttpError(409,'This material preparation changed. Refresh before saving.');
   }else if(input.version!==0)throw new HttpError(409,'New material preparation starts at version zero.');
   if(existing){
    const before=existing.fixed.snapshot.sites[0];
    if(before.siteId!==input.source.siteId||before.basisId!==input.source.basisId||before.sourceKind!==input.source.sourceKind)throw new HttpError(409,'Keep this preparation linked to its original approved site and BOQ.');
   }
   if(existing){
    const sent=(await c.query("SELECT l.line_key,l.item_id,l.unit,l.description,sum(l.quantity)::text quantity FROM inventory_material_dispatch_lines l JOIN inventory_material_dispatches d ON d.id=l.dispatch_id WHERE d.snapshot#>>'{combinedPlan,id}'=$1 OR d.draft_id=ANY($2::uuid[]) GROUP BY l.line_key,l.item_id,l.unit,l.description",[id,[existing.fixed.id,...(existing.variable?[existing.variable.id]:[])]] )).rows;
    if(sent.length){
     if(input.warehouse!==existing.fixed.snapshot.warehouse)throw new HttpError(409,'Previously issued material must keep its original warehouse.');
     const rows=[...input.fixedLines,...input.variableLines];
     for(const line of sent){const row=rows.find(r=>r.key===line.line_key);if(!row||row.itemId!==line.item_id||row.unit!==line.unit||row.description!==line.description||!row.out||new Decimal(row.out).lt(line.quantity))throw new HttpError(409,'Retain the item, unit and quantity already issued on the saved DO.');}
     if(input.variableSupply!==existing.variableSupply&&sent.some(l=>existing.variable?.snapshot.lines.some((r:any)=>r.key===l.line_key)))throw new HttpError(409,'Issued variable items must retain their original individual or Parent DO supply route.');
     const changed=JSON.stringify(input.fixedLines)!==JSON.stringify(existing.fixed.snapshot.lines)||JSON.stringify(input.variableLines)!==JSON.stringify(existing.variable?.snapshot.lines??[])||JSON.stringify(input.transport)!==JSON.stringify(existing.fixed.snapshot.transport);
     if(changed&&!input.revisionReason)throw new HttpError(422,'Give a reason for revising an issued material preparation.');
    }
   }
   const common={warehouse:input.warehouse,parent:false,sites:[input.source],transport:input.transport,...(input.revisionReason?{revisionReason:input.revisionReason}:{})};
   const fixed=await this.drafts.save(actor,{...common,...(existing?{id:existing.fixed.id}:{}),version:existing?.fixed.version??0,requestKey:childRequest(input.requestKey,'fixed'),kind:'fixed',lines:input.fixedLines},c);
   // Read the server-resolved scope; unknown scope can be saved as a draft but
   // a delivery-only sale must not acquire installation variance or a pool.
   const resolved=await this.drafts.detail(actor,fixed.id,c);
   if(resolved.snapshot.sites[0].installation===false&&(input.variableLines.length||input.variableSupply==='parent-do'))throw new HttpError(422,'Delivery-only product sales do not have cable variance or a Parent DO supply route.');
   const variable=resolved.snapshot.sites[0].installation===false?null:await this.drafts.save(actor,{...common,...(existing?.variable?{id:existing.variable.id}:{}),version:existing?.variable?.version??0,requestKey:childRequest(input.requestKey,'variable'),kind:'variable',lines:input.variableLines},c);
   if(!existing)await c.query('INSERT INTO inventory_site_material_plans(id,created_by) VALUES($1,$2)',[id,actor]);
   await c.query(`INSERT INTO inventory_site_material_plan_versions(plan_id,version,fixed_draft_id,fixed_draft_version,variable_draft_id,variable_draft_version,variable_supply,request_key,request_fingerprint,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,input.version+1,fixed.id,fixed.version,variable?.id??null,variable?.version??null,input.variableSupply,input.requestKey,fingerprint(input),actor]);
   return {id,version:input.version+1,stockPosting:false as const};
  });
 }
}
