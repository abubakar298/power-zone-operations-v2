import {historicalApprovedOrder} from '../ubl/historical-approved-order.js';
import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {Decimal} from 'decimal.js';
import ledger from './approved-parent-ledger.json' with {type:'json'};
import {InventoryRepository} from './repository.js';
import {requireQcMaterialSite} from './qc-material-access.js';
import {completionEvidence} from '../../shared/qc-completion-evidence.js';
import {entrySchema,reconcile} from './reconciliation.js';
import {HttpError} from '../http/errors.js';
import {transaction} from '../db/transaction.js';
import {lockActiveActor} from '../auth/actor-lock.js';

const allowed=new Set([304,346,345,308,288,313,314,294,291,305,297,289,285,315,302,319,316,292,295,332].map(String));
const inputSchema=z.object({version:z.number().int().nonnegative(),requestKey:z.uuid(),reason:z.string().trim().min(3).max(2000),verify:z.boolean(),entry:entrySchema}).strict();
/** Historical references supply issued quantities only. Never project their used,
 * returned, adjustment or local-purchase values into a fresh QC usage entry. */
export function historicalIssuedMaterials(ipo:string){
 return ledger.groups.flatMap(g=>g.sites.some(s=>s.ipo===ipo)?g.rows.flatMap((r:any)=>
  (r.allocations??[]).filter((a:any)=>a.ipo===ipo&&a.origin==='warehouse_stock').map((a:any,index:number)=>({key:g.id+':'+r.id+':'+index,itemId:r.itemId,description:a.sourceDescription??r.item,unit:r.unit,issued:a.doQty==null?null:String(a.doQty),reference:g.historicalParent?'DO '+g.historicalParent:(a.doSource??g.title),sourceUrl:a.doSource??null}))):[]);
}
/** Owner-authorized additions: only cables absent from the saved BOQ, retaining
 * recorded units/origins. This is usage evidence, never warehouse return credit. */
export function additionalParentCables(ipo:string){
 const covered=new Set(['CH-CBL-AC-16MM/4C-PK','CH-CBL-AC-25MM/4C-PK','CH-CBL-DC-6MM/1C-R/PK','CH-CBL-DC-6MM/1C-B/PK','CH-CBL-ERT-2.5MM/1C-PK','CH-CBL-ERT-6MM/1C-PK','CH-CBL-ERT-10MM/1C-PK']);
 const cables=new Map<string,{description:string;unit:string;used:string;origin:string}>();
 for(const g of ledger.groups)for(const r of g.rows as any[])if(r.itemId.startsWith('CH-CBL-')&&!covered.has(r.itemId))for(const a of r.allocations??[]){
  if(a.ipo!==ipo)continue;const key=r.itemId+'|'+r.unit,old=cables.get(key);
  cables.set(key,{description:r.itemId+' · '+r.item,unit:r.unit,used:a.used==null||old?.used===''?'':new Decimal(old?.used??0).plus(a.used).toString(),origin:old&&old.origin!==a.origin?'Mixed source':a.origin});
 }
 return [...cables.values()];
}
export class HistoricalQcUsageRepository{
 constructor(private pool:Pool){}
 private async identity(actor:string,boardId:string,c:Pool|PoolClient=this.pool,write=false){
  const board=await requireQcMaterialSite(actor,boardId,c,write);
  const match=/^registered-UBL:SOLAR:(\d+)$/.exec(boardId);
  if(!match||!allowed.has(match[1]))throw new HttpError(404,'No reviewed historical material linkage is available for this site.');
  const native=(await c.query(`SELECT 1 FROM inventory_material_draft_versions v WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(v.snapshot->'sites') s WHERE s->>'registeredSiteId'=$1) LIMIT 1`,[boardId])).rowCount;
  if(native)throw new HttpError(409,'Use this site’s existing material dispatch usage form.');
  const legacy=(await c.query('SELECT site_id FROM ubl_site_orders WHERE legacy_ipo_number=$1 AND status=$2',[match[1],'Active'])).rows;
  let key=legacy.length===1?'ubl:'+legacy[0].site_id:null;
  if(!key){const old=(await c.query('SELECT site_id FROM ubl_site_orders WHERE legacy_ipo_number=$1',[match[1]])).rows;if(old.length===1&&(await historicalApprovedOrder(c,String(old[0].site_id))))key='ubl:'+old[0].site_id;}

  if(!key&&z.uuid().safeParse(board.origin?.ipoId).success)key='ipo:'+board.origin.ipoId;
  if(!key){const links=(await c.query('SELECT DISTINCT ipo_id FROM inventory_material_source_links WHERE board_site_id=$1',[boardId])).rows;if(links.length===1)key='ipo:'+links[0].ipo_id;}
  // Registered Operations imports may predate the native IPO source-link row.
  // Resolve the exact issued IPO number, never a site-name or configuration guess.
  if(!key){const issued=(await c.query("SELECT id FROM internal_purchase_orders WHERE number=$1 AND snapshot->'customer'->>'shortCode'='UBL' AND snapshot->>'boqRevisionId' IS NOT NULL",['CHP-'+match[1]])).rows;if(issued.length===1)key='ipo:'+issued[0].id;}
  if(!key)throw new HttpError(409,'The historical site needs its exact approved IPO/BOQ link before usage can be entered.');
  return {board,key,ipo:'CHP-'+match[1]};
 }
 async read(actor:string,boardId:string){
  const identity=await this.identity(actor,boardId),job=await new InventoryRepository(this.pool).job(actor,identity.key);
  const previous=(await this.pool.query('SELECT r.id,v.version,v.stage,v.snapshot FROM inventory_reports r JOIN LATERAL(SELECT * FROM inventory_report_versions WHERE report_id=r.id ORDER BY version DESC LIMIT 1)v ON true WHERE r.job_key=$1',[identity.key])).rows[0];
  const own=previous?.snapshot?.qcUsage?.boardId===boardId;
  const locked=(await this.pool.query(`SELECT 1 FROM accounts_pt_entries WHERE source_kind='Inventory' AND source_id=$1 UNION ALL SELECT 1 FROM (SELECT stage FROM accounts_active_job_closures WHERE job_key=$2 ORDER BY version DESC LIMIT 1) latest WHERE stage IN('Closed','Awaiting Management') LIMIT 1`,[previous?.id??null,identity.key])).rowCount!>0;
  return {boardId,jobKey:identity.key,ipo:identity.ipo,version:previous?.version??0,locked,additionalCables:additionalParentCables(identity.ipo),issued:historicalIssuedMaterials(identity.ipo),lines:job.lines.map(l=>({key:l.key,description:l.description,unit:l.unit,approved:l.approved,group:l.group})),entry:own?previous.snapshot.entry:null,stage:own?previous.stage:null,stockPosting:false};
 }
 async save(actor:string,boardId:string,raw:unknown){
  const parsed=inputSchema.safeParse(raw);if(!parsed.success)throw new HttpError(422,'Check usage quantities and enter the source reference.');const input=parsed.data;
  const identity=await this.identity(actor,boardId,this.pool,true),job=await new InventoryRepository(this.pool).job(actor,identity.key);
  const cables=additionalParentCables(identity.ipo);
  if(new Set(input.entry.extra.map(e=>e.description+'|'+e.unit)).size!==input.entry.extra.length||input.entry.extra.some(e=>!cables.some(c=>c.description===e.description&&c.unit===e.unit&&c.used!==''&&e.used===c.used)))throw new HttpError(422,'Additional rows must be the recorded Parent reconciliation cables and quantities. Other extra items are left for later.');
  if(input.verify&&cables.some(c=>c.used!==''&&!input.entry.extra.some(e=>e.description===c.description&&e.unit===c.unit)))throw new HttpError(422,'Include the recorded additional Parent cables before verifying usage.');
  if(Object.keys(input.entry.usage).some(key=>!job.lines.some(l=>l.key===key&&l.group!=='watt')))throw new HttpError(422,'Usage must refer to this site’s approved BOQ items.');
  if(input.verify&&job.lines.some(l=>l.group==='watt'?!(input.entry.panelCount&&input.entry.panelWattage&&new Decimal(input.entry.panelCount).gt(0)&&new Decimal(input.entry.panelCount).isInteger()&&new Decimal(input.entry.panelWattage).gt(0)):!input.entry.usage[l.key]))throw new HttpError(422,'Enter every actual quantity from the source, including explicit zero. Save a draft if a quantity is unconfirmed.');
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);const current=await this.identity(actor,boardId,c,true);
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['irr:'+current.key]);
   const replay=(await c.query('SELECT report_id,version,snapshot,created_by FROM inventory_report_versions WHERE request_key=$1',[input.requestKey])).rows[0];
   if(replay){if(replay.created_by!==actor||!isDeepStrictEqual(replay.snapshot.qcUsage?.input,input)||replay.snapshot.qcUsage?.boardId!==boardId)throw new HttpError(409,'This request belongs to another usage entry.');return {reportId:replay.report_id,version:replay.version,stockPosting:false};}
   const closure=(await c.query("SELECT stage FROM accounts_active_job_closures WHERE job_key=$1 ORDER BY version DESC LIMIT 1",[current.key])).rows[0];
   if(closure&&['Closed','Awaiting Management'].includes(closure.stage))throw new HttpError(409,'This job has already been submitted or closed. Its saved usage is preserved.');
   let report=(await c.query('SELECT id FROM inventory_reports WHERE job_key=$1 FOR UPDATE',[current.key])).rows[0];
   const previous=report?(await c.query('SELECT version FROM inventory_report_versions WHERE report_id=$1 ORDER BY version DESC LIMIT 1',[report.id])).rows[0]:null;
   if((previous?.version??0)!==input.version)throw new HttpError(409,'Material usage changed. Refresh before saving.');
   if(report&&(await c.query("SELECT 1 FROM accounts_pt_entries WHERE source_kind='Inventory' AND source_id=$1 LIMIT 1",[report.id])).rowCount)throw new HttpError(409,'PT entry already exists. Accounts must review a correction before changing usage.');
   const docs=current.board.documents??[],typed=completionEvidence(docs.find((d:any)=>d.id===boardId+':historical-handover-documents'||d.id===boardId+':completion-documents'));
   const qc=current.board.qcJob??current.board.qc?.handover??current.board.qc?.signoff??typed;
   const dos=[...(current.board.deliveries??[]).map((d:any)=>d.signedDo),...docs.filter((d:any)=>d.id===boardId+':historical-delivery-documents').flatMap((d:any)=>d.evidence??[])].filter(Boolean);
   const vso=qc?.variableSignoff;
   if(input.verify&&(!dos.length||!vso||dos.some((d:any)=>d.id===vso.id)))throw new HttpError(422,'Attach this site’s signed DO and distinct VSO before verifying usage.');
   const ids=[...new Set([...dos.map((d:any)=>d.id),vso?.id].filter(Boolean))];
   const files=ids.length?(await c.query('SELECT id,filename,media_type,content FROM operations_board_files WHERE site_id=$1 AND id=ANY($2::uuid[])',[boardId,ids])).rows:[];
   if(input.verify&&files.length!==ids.length)throw new HttpError(422,'The referenced signed files are not available for this site.');
   if(!report)report=(await c.query('INSERT INTO inventory_reports(id,job_key,created_by) VALUES($1,$2,$3) RETURNING id',[randomUUID(),current.key,actor])).rows[0];
   const snapshot={...job,entry:input.entry,reconciliation:reconcile(job.lines,input.entry),qcUsage:{boardId,source:'QC historical usage',reason:input.reason,input,evidenceIds:ids,usageSource:'New source entry only; old reconciliation usage not copied',originalFiles:files.map(f=>({id:f.id,filename:f.filename,source:'Operations QC',reportCopy:f.content.length<=8388608})),stockPosting:false}};
   const stage=input.verify?'Sent to Accounts':'IRR Received';
   await c.query('INSERT INTO inventory_report_versions(id,report_id,version,stage,snapshot,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),report.id,input.version+1,stage,snapshot,input.requestKey,actor]);
   for(const f of files.filter(f=>f.content.length<=8388608))if(!(await c.query('SELECT 1 FROM inventory_report_files WHERE report_id=$1 AND filename=$2 AND content=$3',[report.id,f.filename,f.content])).rowCount)await c.query('INSERT INTO inventory_report_files(id,report_id,filename,media_type,content,created_by) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),report.id,f.filename,f.media_type,f.content,actor]);
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'qc.historical-material-usage:'+boardId+':'+(input.version+1)]);
   return {reportId:report.id,version:input.version+1,stage,stockPosting:false};
  });
 }
}
