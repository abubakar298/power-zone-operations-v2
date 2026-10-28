import {lockActiveActor} from '../auth/actor-lock.js';
import {requireQcMaterialSite} from './qc-material-access.js';
import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {Decimal} from 'decimal.js';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';
import {MaterialDraftRepository} from './material-drafts.js';
import {reconcileMaterialDispatch,materialSiteDocuments} from './material-dispatch.js';
import {materialDocumentPolicy} from '../../shared/material-documents.js';

const amount=z.union([z.string().regex(/^\d{1,14}(?:\.\d{1,6})?$/).transform(v=>new Decimal(v).toString()),z.null()]);
export const materialUsageInputSchema=z.object({draftId:z.uuid(),siteId:z.uuid(),version:z.number().int().nonnegative(),requestKey:z.uuid(),date:z.iso.date(),state:z.enum(['reported','signed']),reason:z.string().trim().min(3).max(2000),customerEvidenceId:z.uuid().nullable(),internalEvidenceId:z.uuid().nullable(),lines:z.array(z.object({lineKey:z.uuid(),issued:amount,used:amount,returned:amount}).strict()).max(2000)}).strict();
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const latestUsage=`SELECT DISTINCT ON(site_id) * FROM inventory_material_site_usage_versions WHERE draft_id=$1 ORDER BY site_id,version DESC`;
export function siteUsageEvidenceHolds(row:{key:string;itemId:string;description:string;warehouseOut:string;sites:string[]},parent:boolean,reports:{site_id:string;snapshot:{state:string;lines:{lineKey:string;issued:string|null;used:string|null;returned:string|null}[]}}[]){
 const signed=row.sites.every(siteId=>reports.find(r=>r.site_id===siteId)?.snapshot.state==='signed');
   const holds:string[]=[];
   for(const siteId of row.sites){const entry=reports.find(r=>r.site_id===siteId)?.snapshot.lines.find((l:any)=>l.lineKey===row.key);if(!entry||entry.used===null)continue;
    if(materialDocumentPolicy(row).installationReconciliation){
     if(parent&&entry.issued===null)holds.push('Site issued allocation pending');
     if(entry.issued!==null){const expected=new Decimal(entry.issued).minus(entry.used);if(entry.returned!==null&&!expected.equals(entry.returned)||expected.lt(0))holds.push('IRR correction needed');else if(expected.gt(0)&&entry.returned===null)holds.push('Internal return quantity pending');}
    }
    if(!parent&&entry.issued!==null&&!new Decimal(entry.issued).equals(row.warehouseOut))holds.push('Site issued quantity needs reconciliation');
   }
   if(!signed)holds.push('Site sign-off evidence pending');
 return [...new Set(holds)];
}

/** Inventory reviews site evidence; assigned QC records its own site only.
 * Neither this repository nor its documents can change warehouse balances. */
export class MaterialUsageRepository{
 private drafts:MaterialDraftRepository;
 constructor(private pool:Pool){this.drafts=new MaterialDraftRepository(pool);}
 private async usageDraft(actor:string,draftId:string,c:Pool|PoolClient,siteId?:string,write=false){
  const role=(await c.query('SELECT role FROM users WHERE id=$1',[actor])).rows[0]?.role;
  if(role!=='Operations')return this.drafts.detail(actor,draftId,c);
  if(!siteId)throw new HttpError(403,'Open material usage from your assigned Operations site.');
  const draft=(await c.query('SELECT d.id,v.version,v.snapshot,v.created_at FROM inventory_material_drafts d JOIN LATERAL(SELECT * FROM inventory_material_draft_versions WHERE draft_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.id=$1',[draftId])).rows[0];
  const source=draft?.snapshot.sites.find((s:any)=>s.siteId===siteId);if(!source?.registeredSiteId)throw new HttpError(404,'Material dispatch is not linked to your Operations site.');
  await requireQcMaterialSite(actor,source.registeredSiteId,c,write);return {...draft,stockPosting:false};
 }
 async qcEvidence(actor:string,boardId:string,fileId:string){
  await requireQcMaterialSite(actor,boardId,this.pool);
  let file=(await this.pool.query('SELECT filename,media_type,content FROM operations_board_files WHERE site_id=$1 AND id=$2',[boardId,fileId])).rows[0];
  if(!file){const linked=(await this.pool.query(`SELECT 1 FROM inventory_material_site_usage_versions u JOIN LATERAL(SELECT snapshot FROM inventory_material_draft_versions WHERE draft_id=u.draft_id ORDER BY version DESC LIMIT 1)d ON true WHERE (u.snapshot->>'customerEvidenceId'=$2 OR u.snapshot->>'internalEvidenceId'=$2) AND EXISTS(SELECT 1 FROM jsonb_array_elements(d.snapshot->'sites') s WHERE s->>'registeredSiteId'=$1 AND s->>'siteId'=u.site_id::text) LIMIT 1`,[boardId,fileId])).rowCount;
   if(linked)file=(await this.pool.query('SELECT original_name filename,media_type,content FROM inventory_material_evidence WHERE id=$1',[fileId])).rows[0];
  }
  if(!file)throw new HttpError(404,'This evidence is not linked to your site.');await this.pool.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'inventory.qc.evidence:'+fileId]);return file;
 }
 async qcSite(actor:string,boardId:string){
  const board=await requireQcMaterialSite(actor,boardId,this.pool);
  const drafts=(await this.pool.query(`SELECT d.id,v.snapshot FROM inventory_material_drafts d JOIN LATERAL(SELECT snapshot FROM inventory_material_draft_versions WHERE draft_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(v.snapshot->'sites') s WHERE s->>'registeredSiteId'=$1) ORDER BY d.created_at,d.id`,[boardId])).rows;
  const records=[];for(const root of drafts){const source=root.snapshot.sites.find((s:any)=>s.registeredSiteId===boardId),data=await this.read(actor,root.id,this.pool,source.siteId);if(!data.reconciliation&&!data.workLines.length)continue;const report=data.reports.find(r=>r.site_id===source.siteId);records.push({draftId:root.id,siteId:source.siteId,parent:root.snapshot.parent,kind:root.snapshot.kind,warehouse:root.snapshot.warehouse,references:data.references,report:report?{version:report.version,snapshot:report.snapshot}:null,lines:[...data.dispatch.lines.filter((l:any)=>l.sites.includes(source.siteId)).map((l:any)=>({key:l.key,itemId:l.itemId,description:l.description,unit:l.unit,issued:root.snapshot.parent?null:l.out,customer:materialDocumentPolicy(l).customerUsageSignoff,work:false})),...data.workLines.filter((l:any)=>l.sites.includes(source.siteId)).map((l:any)=>({key:l.key,itemId:l.itemId,description:l.description,unit:l.unit,issued:l.out,customer:false,work:true}))]});}
  const files=(await this.pool.query('SELECT id,filename,media_type FROM operations_board_files WHERE site_id=$1 ORDER BY created_at DESC,id',[boardId])).rows;
  return {site:{id:boardId,name:board.name,ipo:board.ipo},records,files,stockPosting:false};
 }
 async read(actor:string,draftId:string,client:Pool|PoolClient=this.pool,siteId?:string){
  const draft=await this.usageDraft(actor,draftId,client,siteId),s=draft.snapshot;
  const reports=(await client.query(latestUsage,[draftId])).rows;
  const issued=(await client.query(`SELECT l.line_key,sum(l.quantity)::text out FROM inventory_material_dispatch_lines l JOIN inventory_material_dispatches d ON d.id=l.dispatch_id WHERE d.draft_id=$1 GROUP BY l.line_key`,[draftId])).rows;
  const references=(await client.query('SELECT number FROM inventory_material_dispatches WHERE draft_id=$1 ORDER BY created_at,id',[draftId])).rows.map(r=>r.number as string);
  const receipts=(await client.query('SELECT id,number,evidence_id,snapshot FROM inventory_material_receipts WHERE draft_id=$1 ORDER BY created_at,id',[draftId])).rows;
  const workLines=s.kind==='fixed'?s.lines.filter((r:any)=>r.itemId&&r.unit&&r.out!==''&&materialDocumentPolicy(r).approvedQuantityLocked):[];
  const sourceLines=s.lines.filter((r:any)=>r.itemId&&r.unit&&!materialDocumentPolicy(r).approvedQuantityLocked);
  const dispatch={id:draftId,reference:'Preparation '+draftId,warehouse:s.warehouse,kind:s.kind,parent:s.parent,sites:s.sites.map((r:any)=>({id:r.siteId,ipo:r.ipo??'',installation:r.installation===true,basisId:r.basisId,basisVersion:r.basisVersion})),lines:sourceLines.map((r:any)=>({...(r.documentPolicyVersion?{documentPolicyVersion:r.documentPolicyVersion}:{}),key:r.key,itemId:r.itemId,description:r.description||r.itemId,unit:r.unit,out:new Decimal(issued.find(v=>v.line_key===r.key)?.out??0).toString(),sites:r.sites})),usage:reports.flatMap(r=>r.snapshot.lines.filter((l:any)=>sourceLines.some((s:any)=>s.key===l.lineKey)).map((l:any)=>({siteId:r.site_id,lineKey:l.lineKey,issued:l.issued,used:l.used,returned:l.returned}))),extraSources:[],receipts:receipts.map(r=>({id:r.id,reference:r.number,dispatchId:draftId,evidenceId:r.evidence_id,status:'verified',lines:r.snapshot.lines.reduce((rows:any[],l:any)=>{const old=rows.find(v=>v.lineKey===l.lineKey);if(old)old.quantity=new Decimal(old.quantity).plus(l.quantity).toString();else rows.push({lineKey:l.lineKey,quantity:l.quantity});return rows;},[])}))};
  const hasOut=issued.some(r=>new Decimal(r.out).gt(0));
  const calculated=hasOut?reconcileMaterialDispatch(dispatch):null;
  const reconciliation=calculated?{...calculated,rows:calculated.rows.map(row=>{
   const evidenceHolds=siteUsageEvidenceHolds(row,s.parent,reports);return {...row,ready:row.ready&&!evidenceHolds.length,status:row.ready&&evidenceHolds.length?evidenceHolds[0]:row.status,evidenceHolds};
  }),ready:false}:null;
  if(reconciliation)reconciliation.ready=reconciliation.rows.every(r=>r.ready);
  return {draft,reports,references,dispatch,reconciliation,workLines,stockPosting:false as const};
 }
 async save(actor:string,raw:z.infer<typeof materialUsageInputSchema>){
  const input=materialUsageInputSchema.parse(raw);
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.material.usage.request.'||$1,0))",[input.requestKey]);
   const replay=(await c.query('SELECT draft_id,site_id,version,request_fingerprint,created_by FROM inventory_material_site_usage_versions WHERE request_key=$1',[input.requestKey])).rows[0];
   if(replay){await this.usageDraft(actor,replay.draft_id,c,replay.site_id,true);if(replay.created_by!==actor||replay.request_fingerprint!==hash(input))throw new HttpError(409,'This request belongs to another site usage record.');return {draftId:replay.draft_id,siteId:replay.site_id,version:replay.version,stockPosting:false};}
   await c.query('SELECT id FROM inventory_material_drafts WHERE id=$1 FOR UPDATE',[input.draftId]);
   const data=await this.read(actor,input.draftId,c,input.siteId),s=data.draft.snapshot,site=s.sites.find((v:any)=>v.siteId===input.siteId);
   if(!site)throw new HttpError(404,'The selected site is outside this material dispatch.');
   if((await c.query('SELECT role FROM users WHERE id=$1',[actor])).rows[0]?.role==='Operations')await requireQcMaterialSite(actor,site.registeredSiteId,c,true);
   if(site.installation!==true)throw new HttpError(422,'Delivery-only sales do not have installation usage reports.');
   if(!data.reconciliation&&!data.workLines.length)throw new HttpError(409,'Record the physical warehouse dispatch before site use.');
   const previous=data.reports.find(r=>r.site_id===input.siteId);
   if((previous?.version??0)!==input.version)throw new HttpError(409,'This site usage changed. Refresh before saving.');
   if(new Set(input.lines.map(l=>l.lineKey)).size!==input.lines.length)throw new HttpError(422,'Record each site material row once.');
   let customer=false,internal=false;
   for(const line of input.lines){
    const row=s.lines.find((v:any)=>v.key===line.lineKey);
    if(!row?.sites.includes(input.siteId)||!row.itemId||!row.unit)throw new HttpError(422,'The usage row needs its original site, final stock ID and recorded unit.');
    const policy=materialDocumentPolicy(row);if(policy.approvedQuantityLocked&&(s.kind!=='fixed'||line.issued!==row.out))throw new HttpError(422,'The approved non-stock work quantity is locked to its BOQ basis.');if(policy.approvedQuantityLocked&&line.returned!==null&&line.returned!=='0')throw new HttpError(422,'Non-stock work has no warehouse return quantity.');customer ||= policy.customerUsageSignoff;internal ||= policy.installationReconciliation;
    if(input.state==='signed'&&line.used===null)throw new HttpError(422,'Record measured use, including explicit zero, before attaching signed evidence.');
    if(s.parent&&policy.customerUsageSignoff&&line.issued!==null&&line.issued!==line.used)throw new HttpError(422,'For parent variable-material supply, the measured quantity issued at site must equal the quantity used.');
   }
   if(input.state==='signed'&&(!input.lines.length||customer&&!input.customerEvidenceId||internal&&!input.internalEvidenceId))throw new HttpError(422,'Attach customer sign-off for cables/pipes/ducts and internal evidence for other reported items.');
   for(const id of new Set([input.customerEvidenceId,input.internalEvidenceId].filter(Boolean))){const evidence=(await c.query('SELECT warehouse FROM inventory_material_evidence WHERE id=$1',[id])).rows[0];const siteEvidence=site.registeredSiteId?(await c.query('SELECT id FROM operations_board_files WHERE id=$1 AND site_id=$2',[id,site.registeredSiteId])).rows[0]:null;
    const role=(await c.query('SELECT role FROM users WHERE id=$1',[actor])).rows[0]?.role;
    if(role==='Operations'?!siteEvidence:!siteEvidence&&(!evidence||evidence.warehouse!==s.warehouse))throw new HttpError(422,'The signed evidence must belong to this site or its reviewed warehouse dispatch.');}
   const snapshot={date:input.date,state:input.state,customerEvidenceId:input.customerEvidenceId,internalEvidenceId:input.internalEvidenceId,lines:input.lines,siteName:site.siteName,ipo:site.ipo,orderNumber:site.orderNumber??'',stockPosting:false};
   await c.query('INSERT INTO inventory_material_site_usage_versions(draft_id,site_id,version,snapshot,reason,request_key,request_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[input.draftId,input.siteId,input.version+1,snapshot,input.reason,input.requestKey,hash(input),actor]);
   return {draftId:input.draftId,siteId:input.siteId,version:input.version+1,stockPosting:false};
  });
 }
 async site(actor:string,draftId:string,siteId:string){
  const data=await this.read(actor,draftId,this.pool,siteId);if(!data.reconciliation&&!data.workLines.length)throw new HttpError(409,'No warehouse dispatch or approved work has been recorded.');const source=data.draft.snapshot.sites.find((s:any)=>s.siteId===siteId);if(!source)throw new HttpError(404,'Site not found in this dispatch.');const report=data.reports.find(r=>r.site_id===siteId)??null;
  const documents=data.reconciliation?materialSiteDocuments(data.dispatch,siteId):{customerUsage:[],installationReconciliation:[]};
  const work=data.workLines.filter((r:any)=>r.sites.includes(siteId)).map((r:any)=>{const used=report?.snapshot.lines.find((l:any)=>l.lineKey===r.key)?.used??null;return {itemId:r.itemId,description:r.description,unit:r.unit,issuedAtSite:r.out,used,returnedAtSite:null,remark:used===null?'Work completion pending':new Decimal(used).gt(r.out)?'Additional approved work basis needed':'Approved work; not warehouse stock'};});
  return {...data,source,documents:{...documents,installationReconciliation:[...documents.installationReconciliation,...work]},report};
 }
}
