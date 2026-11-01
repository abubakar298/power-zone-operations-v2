import {dispatchReconciliationEligibleSql} from './dispatch-reconciliation-eligibility.js';
import {siteAcknowledgementModels} from '../../shared/site-acknowledgement.js';
import {temporaryNegativeDoBalanceAllowed} from './do-negative-balance.js';
import {UnsignedDoRepository} from './unsigned-do.js';
import {nextWarehouseClosing} from './warehouse-ledger.js';
import {materialDispatchDraftLink} from './material-dispatch-link.js';
import {deferDispatch,dispatchPosted} from './signed-dispatch.js';
import {requireOpenParent} from './parent-open.js';
import {stockLedger} from './stock-ledger.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {Decimal} from 'decimal.js';
import {z} from 'zod';
import {HttpError} from '../http/errors.js';
import {transaction} from '../db/transaction.js';
import {MaterialDraftRepository,materialDraftInputSchema} from './material-drafts.js';
import {warehouseLedgerKey} from './warehouse-source.js';
import {warehouseNumber,requireWarehouseAccess,lockWarehouseAuthority} from './warehouse-access.js';
import {warehousePosition,warehousePositions} from './warehouse-ledger.js';
import {materialDocumentPolicy} from '../../shared/material-documents.js';
import {approvedEarthingBasis} from '../../shared/material-preparation.js';

const quantity=z.string().regex(/^\d{1,14}(?:\.\d{1,6})?$/).refine(v=>new Decimal(v).gt(0),'Enter a positive quantity.').transform(v=>new Decimal(v).toString());
export const materialIssueInputSchema=z.object({draftId:z.uuid(),version:z.number().int().positive(),requestKey:z.uuid(),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),authorityVersion:z.number().int().positive(),reason:z.string().trim().min(3).max(2000),transport:materialDraftInputSchema.shape.transport,
 lines:z.array(z.object({lineKey:z.uuid(),quantity,ledgerRevision:z.number().int().nonnegative()}).strict()).min(1).max(2000),
}).strict();
export const materialReceiptInputSchema=z.object({draftId:z.uuid(),requestKey:z.uuid(),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),authorityVersion:z.number().int().positive(),evidenceId:z.uuid(),reason:z.string().trim().min(3).max(2000),qcUsageVersions:z.array(z.object({siteId:z.uuid(),version:z.number().int().positive()}).strict()).max(2000).optional(),lines:z.array(z.object({lineKey:z.uuid(),quantity,ledgerRevision:z.number().int().nonnegative()}).strict()).min(1).max(2000)}).strict();
export const materialEvidenceInputSchema=z.object({warehouse:z.string().trim().min(1).max(200),filename:z.string().trim().min(1).max(200),mediaType:z.enum(['application/pdf','image/png','image/jpeg']),base64:z.string().min(4).max(20971520)}).strict();
type IssueInput=z.infer<typeof materialIssueInputSchema>;
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Physical postings only. Preparation, signatures and use never call this
 * automatically. No replay of historical DO/IRR/IGP sources is accepted. */
export class MaterialStockRepository{
 private drafts:MaterialDraftRepository;
 constructor(private pool:Pool){this.drafts=new MaterialDraftRepository(pool);}
 private async scope(actor:string,warehouse:string,c:Pool|PoolClient=this.pool,printing=false){return requireWarehouseAccess(actor,warehouse,c,printing);}
 private async authority(c:PoolClient,warehouse:string,source:string,version:number){return lockWarehouseAuthority(c,warehouse,source,version);}
 async unsignedDoDetail(actor:string,id:string){return new UnsignedDoRepository(this.pool).detail(actor,id);}
 async unsignedDoChange(actor:string,id:string,raw:unknown){return new UnsignedDoRepository(this.pool).change(actor,id,raw);}
 async ledger(actor:string,input:unknown){return stockLedger(this.pool,actor,input);}
 async overview(actor:string){
  const {warehouses}=await this.drafts.warehouses(actor);
  const authorities=(await this.pool.query('SELECT warehouse,source_sha256 FROM inventory_warehouse_authority_current WHERE warehouse=ANY($1::text[])',[warehouses])).rows;
  const reference=(await this.pool.query("SELECT source_sha256 FROM inventory_warehouse_sources ORDER BY (coalesce(metadata->>'canonicalIds','') ~ '^[1-9][0-9]*$') DESC,created_at DESC,source_sha256 LIMIT 1")).rows[0]?.source_sha256;
  const sources=new Map(warehouses.map(w=>[w,authorities.find(a=>a.warehouse===w)?.source_sha256??reference]));
  const faulty:Record<string,unknown>[]=[];
  const positions:Record<string,unknown[]> = Object.fromEntries(warehouses.map(w=>[w,[]]));
  for(const source of new Set([...sources.values()].filter(Boolean))){
   const tagged=(await this.pool.query(`SELECT payload->>'itemId' "itemId",payload->>'description' description,payload->>'unit' unit,payload->>'warehouse' warehouse,sum(coalesce(payload->>'in','0')::numeric)::text incoming,sum(coalesce(payload->>'out','0')::numeric)::text outgoing FROM inventory_warehouse_source_events WHERE source_sha256=$1 AND payload->>'warehouse'=ANY($2::text[]) AND coalesce(payload->>'condition','') ~* 'faulty|unavailable' GROUP BY payload->>'itemId',payload->>'description',payload->>'unit',payload->>'warehouse'`,[source,warehouses.filter(w=>sources.get(w)===source)])).rows;
   faulty.push(...tagged);
   for(const p of await warehousePositions(this.pool,source)){
    const w=p.baseline.warehouse;if(!warehouses.includes(w)||sources.get(w)!==source)continue;
    positions[w].push({ledgerKey:p.ledgerKey,itemId:p.baseline.itemId,description:p.baseline.description,unit:p.baseline.unit,opening:p.baseline.opening,openingStatus:p.baseline.openingStatus,totalIn:p.totalIn,totalOut:p.totalOut,currentClosing:p.currentClosing,ledgerRevision:p.ledgerRevision,unknown:p.currentClosing===null,negative:p.currentClosing!==null&&new Decimal(p.currentClosing).lt(0)});
   }
  }
  return {positions,faulty,referenceOnly:warehouses.some(w=>!authorities.some(a=>a.warehouse===w))};
 }
 async positions(actor:string,warehouse:string){
  await this.scope(actor,warehouse);
  const authority=(await this.pool.query('SELECT warehouse,version,source_sha256,state FROM inventory_warehouse_authority_current WHERE warehouse=$1',[warehouse])).rows[0];
  // Reading an imported closing source does not activate it for physical issuance.
  const reference=authority?null:(await this.pool.query("SELECT source_sha256 FROM inventory_warehouse_sources ORDER BY (coalesce(metadata->>'canonicalIds','') ~ '^[1-9][0-9]*$') DESC,created_at DESC,source_sha256 LIMIT 1")).rows[0];
  const source=authority?.source_sha256??reference?.source_sha256;
  if(!source)return {authority:null,positions:[],referenceOnly:true};
  const positions=(await warehousePositions(this.pool,source,warehouse)).map(p=>({ledgerKey:p.ledgerKey,itemId:p.baseline.itemId,description:p.baseline.description,unit:p.baseline.unit,opening:p.baseline.opening,totalIn:p.totalIn,totalOut:p.totalOut,currentClosing:p.currentClosing,ledgerRevision:p.ledgerRevision,unknown:p.currentClosing===null,negative:p.currentClosing!==null&&new Decimal(p.currentClosing).lt(0)}));
  return {authority:authority??null,positions,referenceOnly:!authority};
 }
 async movements(actor:string,draftId:string){
  const draft=await this.drafts.detail(actor,draftId);await this.scope(actor,draft.snapshot.warehouse);
  const dispatches=(await this.pool.query(`SELECT d.id,d.number,d.draft_version,d.snapshot,d.created_at FROM inventory_material_dispatches_active d WHERE ${materialDispatchDraftLink} ORDER BY d.created_at,d.id`,[draftId])).rows;for(const d of dispatches){d.stockPosted=await dispatchPosted(this.pool,'dispatch',d.id);d.parent=!!d.snapshot.parent;d.hasSignoffs=d.snapshot.lines.some((row:any)=>Number(row.out)>0&&materialDocumentPolicy(row).customerUsageSignoff);delete d.snapshot;}
  const receipts=(await this.pool.query(`SELECT id,number,evidence_id,reason,created_at FROM inventory_material_receipts WHERE draft_id=$1 OR snapshot->>'originPreparationId'=$1::text ORDER BY created_at,id`,[draftId])).rows;
  const lines=(await this.pool.query(`SELECT l.line_key,l.item_id,l.unit,sum(l.quantity)::text prepared,sum(CASE WHEN ${dispatchReconciliationEligibleSql} THEN l.quantity ELSE 0 END)::text issued,coalesce((SELECT sum(r.quantity) FROM inventory_material_receipt_lines r WHERE r.line_key=l.line_key AND EXISTS(SELECT 1 FROM inventory_material_dispatches_active sent WHERE sent.id=r.dispatch_id AND (sent.draft_id=$1 OR sent.snapshot->'combinedPlan'->>'fixedDraftId'=$1::text OR sent.snapshot->'combinedPlan'->>'variableDraftId'=$1::text))),0)::text returned FROM inventory_material_dispatch_lines_active l JOIN inventory_material_dispatches_active d ON d.id=l.dispatch_id WHERE ${materialDispatchDraftLink} AND l.line_key=ANY($2::uuid[]) GROUP BY l.line_key,l.item_id,l.unit`,[draftId,draft.snapshot.lines.map((r:any)=>r.key)])).rows;
  return {dispatches,receipts,lines:lines.map(r=>({...r,issued:new Decimal(r.issued).toString(),returned:new Decimal(r.returned).toString(),outstanding:new Decimal(r.issued).minus(r.returned).toString(),used:null})),siteUseStatus:'Not yet recorded; outstanding includes site use and material still in custody.'};
 }
 async dispatch(actor:string,id:string){
  const row=(await this.pool.query('SELECT id,number,draft_id,draft_version,warehouse,snapshot,created_at FROM inventory_material_dispatches_active WHERE id=$1',[id])).rows[0];
  if(!row)throw new HttpError(404,'Issued material dispatch not found.');await this.scope(actor,row.warehouse,this.pool,true);const posted=await dispatchPosted(this.pool,'dispatch',id);return {...row,stockPosted:posted,snapshot:{...row.snapshot,stockPosting:posted,sites:row.snapshot.sites.map(({items,...site}:any)=>site)}};
 }
 async acknowledgements(actor:string,id:string){
  const record=await this.dispatch(actor,id); // Existing signed-in user and warehouse scope first.
  const ids=[...new Set<string>(record.snapshot.sites.map((s:any)=>s.siteId))].filter(v=>/^[0-9a-f-]{36}$/i.test(v));
  const rows=ids.length?(await this.pool.query(`SELECT i.id,i.number,i.snapshot,b.snapshot AS boq FROM internal_purchase_orders i LEFT JOIN boq_revisions b ON b.id=(i.snapshot->>'boqRevisionId')::uuid WHERE i.id=ANY($1::uuid[])`,[ids])).rows:[];
  return siteAcknowledgementModels(record,new Map(rows.map(r=>[r.id,r])));
 }
 async uploadEvidence(actor:string,raw:z.infer<typeof materialEvidenceInputSchema>){
  const input=materialEvidenceInputSchema.parse(raw);await this.scope(actor,input.warehouse,this.pool,true);
  const content=Buffer.from(input.base64,'base64');
  if(!content.length||content.length>15*1024*1024||content.toString('base64')!==input.base64)throw new HttpError(422,'Upload a valid file up to 15 MB.');
  const valid=input.mediaType==='application/pdf'?content.subarray(0,5).toString()==='%PDF-':input.mediaType==='image/png'?content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):content[0]===255&&content[1]===216&&content[2]===255;
  if(!valid)throw new HttpError(422,'The file content does not match its PDF or image type.');
  const name=input.filename.replace(/[\\/\x00-\x1f\x7f]/g,'_'),sha=createHash('sha256').update(content).digest('hex');
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   await this.scope(actor,input.warehouse,c,true);
  await c.query('INSERT INTO inventory_material_evidence(id,warehouse,original_name,media_type,content,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(warehouse,sha256) DO NOTHING',[randomUUID(),input.warehouse,name,input.mediaType,content,sha,actor]);
  return (await c.query('SELECT id,original_name AS name,media_type AS "mediaType",sha256 FROM inventory_material_evidence WHERE warehouse=$1 AND sha256=$2',[input.warehouse,sha])).rows[0];
  });
 }
 async evidence(actor:string,id:string){
  const row=(await this.pool.query('SELECT * FROM inventory_material_evidence WHERE id=$1',[id])).rows[0];
  if(!row)throw new HttpError(404,'Warehouse evidence not found.');await this.scope(actor,row.warehouse,this.pool,true);return row;
 }
 /** Counted warehouse receipt, never an automatic credit from site IRR/use. */
 async receive(actor:string,raw:z.infer<typeof materialReceiptInputSchema>){
  const originalInput=materialReceiptInputSchema.parse(raw);let input=originalInput;
  const origin=await this.drafts.detail(actor,originalInput.draftId);
  if(originalInput.lines.some(r=>!origin.snapshot.lines.some((l:any)=>l.key===r.lineKey)))throw new HttpError(422,'Select returned rows from this preparation.');
  const roots=(await this.pool.query(`SELECT DISTINCT d.draft_id FROM inventory_material_dispatches_active d WHERE ${materialDispatchDraftLink} AND EXISTS(SELECT 1 FROM inventory_material_dispatch_lines_active l WHERE l.dispatch_id=d.id AND l.line_key=ANY($2::uuid[]))`,[originalInput.draftId,originalInput.lines.map(r=>r.lineKey)])).rows;
  if(roots.length>1)throw new HttpError(409,'These materials have more than one DO preparation. Open the exact issued DO before recording its return.');
  if(roots.length===1)input={...originalInput,draftId:roots[0].draft_id};
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.material.receipt.request.'||$1,0))",[input.requestKey]);
   const replay=(await c.query('SELECT r.id,r.number,r.request_fingerprint,r.verified_by,d.snapshot FROM inventory_material_receipts r JOIN LATERAL(SELECT snapshot FROM inventory_material_draft_versions WHERE draft_id=r.draft_id ORDER BY version DESC LIMIT 1)d ON true WHERE r.request_key=$1',[input.requestKey])).rows[0];
   if(replay){await this.scope(actor,replay.snapshot.warehouse,c);if(replay.verified_by!==actor||replay.request_fingerprint!==fingerprint(originalInput))throw new HttpError(409,'This request belongs to a different warehouse receipt.');return {id:replay.id,number:replay.number,stockPosted:true};}
   await c.query('SELECT id FROM inventory_material_drafts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[...new Set([input.draftId,originalInput.draftId])]]);await requireOpenParent(c,input.draftId);
   const draft=await this.drafts.detail(actor,input.draftId,c),warehouse=draft.snapshot.warehouse;
   await this.scope(actor,warehouse,c);await this.authority(c,warehouse,input.sourceSha256,input.authorityVersion);
   const evidence=(await c.query('SELECT id,warehouse,sha256 FROM inventory_material_evidence WHERE id=$1',[input.evidenceId])).rows[0];
   if(!evidence||evidence.warehouse!==warehouse)throw new HttpError(422,'Attach the counted warehouse receipt evidence for this warehouse.');
   if((await c.query('SELECT 1 FROM inventory_material_receipts WHERE draft_id=$1 AND evidence_id=$2',[input.draftId,input.evidenceId])).rowCount)throw new HttpError(409,'This receipt evidence has already been credited to this dispatch preparation.');
   if(new Set(input.lines.map(r=>r.lineKey)).size!==input.lines.length)throw new HttpError(422,'Record each returned material row once.');
   // The same physical original unit cannot arrive once through ordinary IGP
   // and again as a faulty holding. Replacement returns take these exact line
   // locks too; unrelated warehouse movement paths keep their ledger locks.
   await c.query(`SELECT l.line_key FROM inventory_material_dispatch_lines_active l JOIN inventory_material_dispatches_active d ON d.id=l.dispatch_id WHERE ${materialDispatchDraftLink} AND l.line_key=ANY($2::uuid[]) ORDER BY l.dispatch_id,l.line_key FOR UPDATE OF l`,[input.draftId,input.lines.map(r=>r.lineKey)]);
   const replacementsInstalled=(await c.query("SELECT to_regclass('public.inventory_material_replacement_returns') IS NOT NULL AS installed")).rows[0].installed;
   const faultyReturned=replacementsInstalled?"+coalesce((SELECT sum(r.quantity) FROM inventory_material_replacement_returns r JOIN inventory_material_replacement_cases c ON c.id=r.case_id WHERE c.original_dispatch_id=l.dispatch_id AND c.original_line_key=l.line_key),0)":'';
   const sent=(await c.query(`SELECT l.*,d.created_at,d.warehouse,(coalesce((SELECT sum(r.quantity) FROM inventory_material_receipt_lines r WHERE r.dispatch_id=l.dispatch_id AND r.line_key=l.line_key),0)${faultyReturned})::text returned FROM inventory_material_dispatch_lines_active l JOIN inventory_material_dispatches_active d ON d.id=l.dispatch_id WHERE ${materialDispatchDraftLink} AND l.line_key=ANY($2::uuid[]) AND ${dispatchReconciliationEligibleSql} ORDER BY d.created_at,d.id,l.line_key`,[input.draftId,input.lines.map(r=>r.lineKey)])).rows;
   if(input.qcUsageVersions){
    const reports=(await c.query('SELECT DISTINCT ON(site_id) site_id,version,snapshot FROM inventory_material_site_usage_versions WHERE draft_id=$1 ORDER BY site_id,version DESC',[originalInput.draftId])).rows;
    if(!reports.some(r=>r.snapshot.workflowVersion===2&&r.snapshot.state==='signed'))throw new HttpError(409,'QC must save material usage before this return is verified.');
    if(input.qcUsageVersions.length!==reports.length||reports.some(r=>!input.qcUsageVersions!.some(v=>v.siteId===r.site_id&&v.version===r.version)))throw new HttpError(409,'QC usage changed. Refresh the ledger before verifying this return.');
    for(const request of input.lines){const out=sent.filter(r=>r.line_key===request.lineKey).reduce((n,r)=>n.plus(r.quantity),new Decimal(0)),returned=sent.filter(r=>r.line_key===request.lineKey).reduce((n,r)=>n.plus(r.returned),new Decimal(0)),used=reports.reduce((n,r)=>n.plus(r.snapshot.lines.find((l:any)=>l.lineKey===request.lineKey)?.used??0),new Decimal(0));
     if(used.plus(returned).plus(request.quantity).gt(out))throw new HttpError(422,'Counted return exceeds issued material less QC use and previous returns. Correct QC usage or send the discrepancy to Management.');
    }
   }
   const allocations:any[]=[];
   for(const request of input.lines){
    let remaining=new Decimal(request.quantity);
    for(const line of sent.filter(r=>r.line_key===request.lineKey)){
     if(line.source_sha256!==input.sourceSha256||line.warehouse!==warehouse)throw new HttpError(409,'The original dispatch warehouse baseline does not match this receipt.');
     const outstanding=new Decimal(line.quantity).minus(line.returned);if(outstanding.lte(0))continue;
     const value=Decimal.min(remaining,outstanding);allocations.push({...line,quantity:value.toString(),expectedRevision:request.ledgerRevision});remaining=remaining.minus(value);if(remaining.eq(0))break;
    }
    if(remaining.gt(0))throw new HttpError(422,'The return exceeds material actually dispatched less previous warehouse returns. Local purchase needs separate evidence and authority.');
   }
   const positions=new Map<string,NonNullable<Awaited<ReturnType<typeof warehousePosition>>>>();
   for(const key of [...new Set(allocations.map(r=>r.ledger_key))].sort()){
    const p=await warehousePosition(c,input.sourceSha256,key,true);
    if(!p)throw new HttpError(409,'This warehouse item and unit are not in the accepted stock register.');
    if(allocations.some(r=>r.ledger_key===key&&r.expectedRevision!==p.ledgerRevision))throw new HttpError(409,'This warehouse balance changed. Refresh before verifying the receipt.');positions.set(key,p);
   }
   const id=randomUUID(),number=await warehouseNumber(c,'IGP',id);
   const snapshot={warehouse,draftId:input.draftId,...(input.draftId!==originalInput.draftId?{originPreparationId:originalInput.draftId}:{}),evidence:{id:evidence.id,sha256:evidence.sha256},reason:input.reason,lines:allocations.map(r=>({dispatchId:r.dispatch_id,lineKey:r.line_key,itemId:r.item_id,unit:r.unit,quantity:r.quantity})),siteUseStatus:'Not inferred from warehouse receipt'};
   await c.query('INSERT INTO inventory_material_receipts(id,number,draft_id,evidence_id,reason,snapshot,request_key,request_fingerprint,verified_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,number,input.draftId,input.evidenceId,input.reason,snapshot,input.requestKey,fingerprint(originalInput),actor]);
   for(const row of allocations){
    await c.query('INSERT INTO inventory_material_receipt_lines(receipt_id,draft_id,dispatch_id,line_key,quantity) VALUES($1,$2,$3,$4,$5)',[id,input.draftId,row.dispatch_id,row.line_key,row.quantity]);
    const p=positions.get(row.ledger_key)!,before=p.currentClosing,after=nextWarehouseClosing(before,row.quantity,1);
    await c.query("INSERT INTO inventory_warehouse_operational_movements(id,source_sha256,ledger_key,ledger_revision,kind,draft_id,dispatch_id,receipt_id,line_key,in_delta,out_delta,closing_before,closing_after,created_by) VALUES($1,$2,$3,$4,'return-in',$5,$6,$7,$8,$9,0,$10,$11,$12)",[randomUUID(),input.sourceSha256,row.ledger_key,p.ledgerRevision+1,input.draftId,row.dispatch_id,id,row.line_key,row.quantity,before,after,actor]);p.currentClosing=after;p.ledgerRevision++;
   }
   return {id,number,stockPosted:true};
  });
 }
 async issue(actor:string,raw:IssueInput,allowCombined=false){
  const input=materialIssueInputSchema.parse(raw);
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.material.issue.request.'||$1,0))",[input.requestKey]);
   const replay=(await c.query('SELECT id,number,warehouse,request_fingerprint,created_by FROM inventory_material_dispatches_active WHERE request_key=$1',[input.requestKey])).rows[0];
   if(replay){await this.scope(actor,replay.warehouse,c);if(replay.created_by!==actor||replay.request_fingerprint!==fingerprint(input))throw new HttpError(409,'This request belongs to a different warehouse dispatch.');return {id:replay.id,number:replay.number,stockPosted:await dispatchPosted(c,'dispatch',replay.id)};}
   await c.query('SELECT id FROM inventory_material_drafts WHERE id=$1 FOR UPDATE',[input.draftId]);await requireOpenParent(c,input.draftId);
   const draft=await this.drafts.detail(actor,input.draftId,c),s=draft.snapshot;
   if(s.combinedPlan&&!allowCombined)throw new HttpError(403,'Create this DO through its saved site material preparation.');
   await this.scope(actor,s.warehouse,c);
   if(draft.version!==input.version)throw new HttpError(409,'This preparation changed. Refresh before issuing material.');
   const currentSources=await this.drafts.requirePendingSources(s.sites,c,s.combinedPlan?.fixedDraftId??input.draftId);
   if(s.kind==='variable'&&!s.parent){
    const deferred=(await c.query(`SELECT 1 FROM (SELECT DISTINCT ON(plan_id) * FROM inventory_site_material_plan_versions ORDER BY plan_id,version DESC)v WHERE variable_draft_id=$1 AND variable_supply='parent-do'`,[input.draftId])).rowCount;
    if(deferred)throw new HttpError(409,'These variable materials are assigned to a Parent DO; do not issue them again as a standalone dispatch.');
   }
   if(!input.transport.issuedTo.trim())throw new HttpError(422,'Record who is receiving custody of this material.');
   await this.authority(c,s.warehouse,input.sourceSha256,input.authorityVersion);
   const keys=new Set(input.lines.map(r=>r.lineKey));if(keys.size!==input.lines.length)throw new HttpError(422,'Select each material row once.');
   const prepared=input.lines.map(request=>{
    const row=s.lines.find((r:any)=>r.key===request.lineKey);if(!row?.itemId||!row.unit||!row.description?.trim())throw new HttpError(422,'Select the final stock ID and recorded unit before issuing this row.');
    const policy=materialDocumentPolicy(row),basis=row.basisLine===undefined?null:s.sites[0]?.items[row.basisLine];
    if(policy.group==='non-stock'||policy.approvedQuantityLocked||basis&&(approvedEarthingBasis(basis)||/^(?:labou?r|delivery|transport|installation|commissioning|civil|misc)/i.test(String(basis.key??basis.description??''))))throw new HttpError(422,'Service or aggregate BOQ allowances are not physical warehouse stock.');
    if(!s.combinedPlan&&s.sites.every((site:any)=>site.installation===true)&&policy.variableDispatch!==(s.kind==='variable'))throw new HttpError(422,'Keep fixed and variable items on their matching dispatches.');
    if(!row.out||new Decimal(request.quantity).gt(row.out))throw new HttpError(422,'The selected quantity exceeds this prepared row. Update the preparation before issuing extra material.');
    return {request,row,ledgerKey:warehouseLedgerKey(row.itemId,s.warehouse,row.unit)};
   });
   if(currentSources.some(source=>source.installationOnly)&&prepared.some(p=>!materialDocumentPolicy(p.row).variableDispatch))throw new HttpError(422,'Installation-only batch sites do not require another fixed-equipment delivery. Issue only the required variable materials.');
   const already=(await c.query(`SELECT l.line_key,sum(l.quantity)::text issued FROM inventory_material_dispatch_lines_active l JOIN inventory_material_dispatches_active d ON d.id=l.dispatch_id WHERE d.draft_id=$1 GROUP BY l.line_key`,[input.draftId])).rows;
   for(const p of prepared)if(new Decimal(p.request.quantity).plus(already.find(r=>r.line_key===p.row.key)?.issued??0).gt(p.row.out))throw new HttpError(409,'This prepared quantity has already been dispatched, including partial trips. Refresh the remaining quantity.');
   const positions=new Map<string,NonNullable<Awaited<ReturnType<typeof warehousePosition>>>>();
   for(const key of [...new Set(prepared.map(p=>p.ledgerKey))].sort()){
    const position=await warehousePosition(c,input.sourceSha256,key,true);if(!position)throw new HttpError(409,'No reviewed opening/closing stock exists for this item, warehouse and unit. Do not assume zero or convert units.');
    const matching=prepared.filter(p=>p.ledgerKey===key);
    if(matching.some(p=>p.request.ledgerRevision!==position.ledgerRevision))throw new HttpError(409,'This warehouse balance changed. Refresh before issuing material.');
    const total=matching.reduce((n,p)=>n.plus(p.request.quantity),new Decimal(0));
    if(!temporaryNegativeDoBalanceAllowed()&&position.currentClosing!==null&&new Decimal(position.currentClosing).lt(total))throw new HttpError(409,'Recorded warehouse stock is insufficient for this issue quantity.');
    positions.set(key,position);
   }
   const id=randomUUID(),reserved=s.parent&&!(await c.query('SELECT 1 FROM inventory_material_dispatches_active WHERE draft_id=$1 LIMIT 1',[input.draftId])).rowCount?(await c.query('SELECT number FROM inventory_parent_preparation_references WHERE draft_id=$1',[input.draftId])).rows[0]?.number:undefined,number=reserved??await warehouseNumber(c,s.parent?'PDO':'DO',id);
   const lines=prepared.map(p=>({...p.row,out:p.request.quantity})),snapshot={...s,lines,transport:input.transport,reason:input.reason,status:'issued',requiresSignedGate:true,allowNegativeBalance:temporaryNegativeDoBalanceAllowed(),sourceSha256:input.sourceSha256,authorityVersion:input.authorityVersion,stockPosting:false};
   await c.query('INSERT INTO inventory_material_dispatches(id,number,draft_id,draft_version,source_sha256,warehouse,snapshot,request_key,request_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,number,input.draftId,input.version,input.sourceSha256,s.warehouse,snapshot,input.requestKey,fingerprint(input),actor]);
   for(const p of prepared){
    await c.query('INSERT INTO inventory_material_dispatch_lines(dispatch_id,line_key,source_sha256,ledger_key,item_id,unit,description,quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,p.row.key,input.sourceSha256,p.ledgerKey,p.row.itemId,p.row.unit,p.row.description,p.request.quantity]);
   }
   await deferDispatch(c,actor,'dispatch',id,s.warehouse,input.sourceSha256,input.authorityVersion,prepared.map(p=>({ledgerKey:p.ledgerKey,quantity:p.request.quantity,kind:'dispatch-out',draftId:input.draftId,dispatchId:id,lineKey:p.row.key})));

   return {id,number,stockPosted:false,awaitingSignedGate:true};
  });
 }
}
