import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {HttpError} from '../http/errors.js';
import {transaction} from '../db/transaction.js';
import {fingerprint} from '../boq/repository.js';
import {CommercialRepository} from '../commercial/repository.js';
import {ptDetail} from '../orders/pt-detail.js';
import {revisedReference} from '../documents/references.js';
import {quotationBasis} from './basis.js';
import {ProjectWorkflowRepository} from './repository.js';

/** IPO revision (phase 1). A saved IPO is never edited. A revision runs through a revised quotation
 * (commercial: same BOQ) or a revised BOQ and quotation (technical), then a proposed new IPO version
 * that Management approves after seeing the reason and old vs new. Approval issues the new version
 * as its own immutable IPO and hands it to Accounts. Allowed only before downstream work starts. */
export const ipoRevisionStartSchema=z.object({route:z.enum(['commercial','technical']),reason:z.string().trim().min(10,'Write why the IPO is revised (at least 10 characters).').max(1900),requestKey:z.uuid()}).strict();
export const ipoRevisionPrepareSchema=z.object({requestKey:z.uuid()}).strict();
export const ipoRevisionDecisionSchema=z.object({decision:z.enum(['Approved','Returned']),note:z.string().trim().max(2000).default(''),requestKey:z.uuid()}).strict();
type Db=Pool|PoolClient;
const management=(role:string)=>['Admin','Management'].includes(role);
const amount=(s:any)=>{const v=s?.footer?.find((row:any)=>row.label==='Net Total')?.amount??s?.allocation?.total??s?.pricing?.payable??s?.netTotal;return v==null?null:String(v);};
/** CPZ-IPO-…-R1 (…); manual and historical numbers such as CHP-351 become CHP-351-R1. */
export function revisedIpoNumber(number:string,revision:number){const next=revisedReference(number,revision);return next===number?number+'-R'+revision:next;}
const footer=(s:any)=>Array.isArray(s?.footer)?s.footer.map((row:any)=>({label:String(row.label??''),amount:row.amount==null?null:String(row.amount)})):[];

export class IpoRevisionRepository{
 constructor(private pool:Pool){}
 private workflow(){return new ProjectWorkflowRepository(this.pool);}
 /** The record's IPO chain: the original issued IPO and every approved revision, oldest first. */
 private async chain(c:Db,recordId:string,originalIpoId:string){
  const original=(await c.query('SELECT id,number,snapshot,created_at FROM internal_purchase_orders WHERE id=$1',[originalIpoId])).rows[0];
  if(!original)throw new HttpError(404,'The issued IPO for this site was not found.');
  const revised=(await c.query(`SELECT i.id,i.number,i.snapshot,i.created_at FROM ipo_revision_decisions d JOIN ipo_revision_proposals p ON p.id=d.proposal_id JOIN ipo_revision_requests q ON q.id=p.request_id JOIN internal_purchase_orders i ON i.id=d.revised_ipo_id WHERE q.record_id=$1 AND d.decision='Approved' ORDER BY d.created_at`,[recordId])).rows;
  return [original,...revised];
 }
 private async requests(c:Db,recordId:string){
  return (await c.query(`SELECT q.*,u.display_name AS requested_by_name,b.number AS base_number,
   p.id AS proposal_id,p.version AS proposal_version,p.number AS proposal_number,p.quotation_id AS proposal_quotation_id,p.created_at AS proposal_created_at,p.snapshot AS proposal_snapshot,
   d.decision,d.note AS decision_note,d.revised_ipo_id,d.created_at AS decided_at,du.display_name AS decided_by_name,
   l.quotation_id AS revised_quotation_id,rq.number AS revised_quotation_number,
   (SELECT kind FROM coordination_events e WHERE e.quotation_id=l.quotation_id ORDER BY e.created_at DESC LIMIT 1) AS revised_quotation_status,
   qr.draft_id,sv.boq_revision_id AS source_boq_revision_id
   FROM ipo_revision_requests q JOIN users u ON u.id=q.created_by JOIN internal_purchase_orders b ON b.id=q.base_ipo_id
   JOIN quotation_revision_requests qr ON qr.id=q.quotation_revision_request_id JOIN quotation_versions sv ON sv.id=qr.source_quotation_id
   LEFT JOIN quotation_revision_links l ON l.request_id=q.quotation_revision_request_id LEFT JOIN quotation_versions rq ON rq.id=l.quotation_id
   LEFT JOIN LATERAL(SELECT * FROM ipo_revision_proposals x WHERE x.request_id=q.id ORDER BY x.version DESC LIMIT 1) p ON true
   LEFT JOIN ipo_revision_decisions d ON d.proposal_id=p.id LEFT JOIN users du ON du.id=d.decided_by
   WHERE q.record_id=$1 ORDER BY q.sequence`,[recordId])).rows;
 }
 private static status(row:any){return row.decision==='Approved'?'Approved':row.decision==='Returned'?'Returned':row.proposal_id?'Awaiting Management approval':'Revising quotation';}
 /** Work that has already started on this IPO stops a revision (agreed rule). */
 async blockers(c:Db,ipoIds:string[],route:'commercial'|'technical'){
  const boards=(await c.query("SELECT DISTINCT ON(site_id) site_id,snapshot FROM operations_board_versions WHERE snapshot->'origin'->>'ipoId'=ANY($1::text[]) ORDER BY site_id,version DESC",[ipoIds])).rows.map(r=>r.site_id as string);
  const reasons:string[]=[];
  if((await c.query("SELECT 1 FROM accounts_pt_entries WHERE source_kind='IPO' AND source_id=ANY($1::uuid[]) UNION ALL SELECT 1 FROM accounts_job_pt_entries WHERE job_key=ANY($2::text[]) LIMIT 1",[ipoIds,ipoIds.map(id=>'ipo:'+id)])).rowCount)reasons.push('Accounts has posted the PT');
  if((await c.query("SELECT 1 FROM accounts_invoice_entries WHERE site_key=ANY($1::text[]) UNION ALL SELECT 1 FROM accounts_invoice_submissions WHERE site_key=ANY($1::text[]) LIMIT 1",[[...ipoIds,...boards]])).rowCount)reasons.push('Accounts has recorded an invoice');
  if((await c.query("SELECT 1 FROM accounts_job_closures WHERE job_key=ANY($1::text[]) LIMIT 1",[ipoIds.map(id=>'ipo:'+id)])).rowCount)reasons.push('the job has a closure record');
  if(route==='technical'&&(await c.query(`SELECT 1 FROM inventory_material_dispatches_active d WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(d.snapshot->'sites') s WHERE s->>'siteId'=ANY($1::text[]) OR s->>'registeredSiteId'=ANY($2::text[])) LIMIT 1`,[ipoIds,boards])).rowCount)reasons.push('Inventory has issued a DO for this site');
  return reasons;
 }
 private async load(actor:string,recordId:string,c:Db=this.pool,lock=false){
  const {u,r}=await this.workflow().record(actor,recordId,c as any,lock);
  if(r.stage!=='issued'||!r.data?.ipoId)throw new HttpError(409,'Only an issued IPO can be revised.');
  if(r.data.amendmentId)throw new HttpError(409,'This job uses a revised PO amendment. Ask Management to review it.');
  const chain=await this.chain(c,r.id,r.data.ipoId),current=chain.at(-1)!;
  return {u,r,chain,current};
 }
 async status(actor:string,recordId:string){
  const {u,r,chain,current}=await this.load(actor,recordId);
  const rows=await this.requests(this.pool,r.id),open=rows.find(x=>!x.decision);
  const quotationSource=current.snapshot?.approvedCommercialSource?.type==='quotation';
  const blockers={commercial:await this.blockers(this.pool,chain.map(i=>i.id),'commercial'),technical:await this.blockers(this.pool,chain.map(i=>i.id),'technical')};
  const canRevise=(u.role==='Coordinator'&&r.coordinator_id===actor)||management(u.role);
  return {original:{id:chain[0].id,number:chain[0].number},current:{id:current.id,number:current.number,amount:amount(current.snapshot)},revisedIpos:chain.slice(1).map(i=>({id:i.id,number:i.number})),
   canStart:canRevise&&quotationSource&&!open,quotationSource,blockers,
   revisions:rows.map(x=>({id:x.id,sequence:x.sequence,route:x.route,reason:x.reason,requestedBy:x.requested_by_name,createdAt:x.created_at,baseNumber:x.base_number,status:IpoRevisionRepository.status(x),draftId:x.draft_id,quotationRevisionRequestId:x.quotation_revision_request_id,sourceBoqRevisionId:x.source_boq_revision_id,
    revisedQuotation:x.revised_quotation_id?{id:x.revised_quotation_id,number:x.revised_quotation_number,status:x.revised_quotation_status}:null,
    proposal:x.proposal_id?{id:x.proposal_id,version:x.proposal_version,number:x.proposal_number,createdAt:x.proposal_created_at,amount:amount(x.proposal_snapshot)}:null,
    decision:x.decision?{decision:x.decision,note:x.decision_note,by:x.decided_by_name,at:x.decided_at,revisedIpoId:x.revised_ipo_id}:null}))};
 }
 async start(actor:string,recordId:string,raw:unknown){
  const v=ipoRevisionStartSchema.parse(raw);
  const replay=(await this.pool.query('SELECT * FROM ipo_revision_requests WHERE request_key=$1',[v.requestKey])).rows[0];
  if(replay){if(replay.record_id!==recordId||replay.created_by!==actor||replay.route!==v.route||replay.reason!==v.reason)throw new HttpError(409,'This request key was used for another IPO revision.');return this.startResult(replay.id);}
  const {u,r,chain,current}=await this.load(actor,recordId);
  if(!(u.role==='Coordinator'&&r.coordinator_id===actor)&&!management(u.role))throw new HttpError(403,'The site coordinator or Management revises an IPO.');
  const source=current.snapshot?.approvedCommercialSource;
  if(source?.type!=='quotation'||!source.id)throw new HttpError(422,'This IPO was not issued from a quotation. Ask Management to review the revision.');
  if((await this.requests(this.pool,r.id)).some(x=>!x.decision))throw new HttpError(409,'An IPO revision is already in progress for this site. Finish it first.');
  const blocked=await this.blockers(this.pool,chain.map(i=>i.id),v.route);
  if(blocked.length)throw new HttpError(409,`This IPO cannot be revised because ${blocked.join('; ')}. Ask Management to review.`);
  // The quotation revision uses the existing routes: technical revises the BOQ, commercial keeps it.
  const quotationRequest=await new CommercialRepository(this.pool).revisionStart(actor,source.id,'Customer',v.route==='technical',`IPO revision (${current.number}): ${v.reason}`,String(r.customer??'Customer'),v.requestKey);
  return transaction(this.pool,async c=>{
   const fresh=await this.load(actor,recordId,c,true);
   if((await this.requests(c,r.id)).some(x=>!x.decision))throw new HttpError(409,'An IPO revision is already in progress for this site. Finish it first.');
   const linked=(await c.query('SELECT id FROM ipo_revision_requests WHERE quotation_revision_request_id=$1',[quotationRequest.id])).rows[0];
   if(linked)throw new HttpError(409,'This quotation revision is already linked to another IPO revision.');
   const sequence=Number((await c.query('SELECT coalesce(max(sequence),0)+1 AS n FROM ipo_revision_requests WHERE record_id=$1',[r.id])).rows[0].n);
   const id=randomUUID();
   await c.query('INSERT INTO ipo_revision_requests(id,record_id,base_ipo_id,sequence,route,reason,quotation_revision_request_id,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,r.id,fresh.current.id,sequence,v.route,v.reason,quotationRequest.id,v.requestKey,actor]);
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`ipo.revision.requested:${id}:${v.route}:${fresh.current.id}`]);
   return this.startResult(id,c);
  });
 }
 private async startResult(id:string,c:Db=this.pool){
  const row=(await c.query('SELECT q.id,q.route,q.quotation_revision_request_id,qr.draft_id,v.boq_revision_id FROM ipo_revision_requests q JOIN quotation_revision_requests qr ON qr.id=q.quotation_revision_request_id JOIN quotation_versions v ON v.id=qr.source_quotation_id WHERE q.id=$1',[id])).rows[0];
  return {id:row.id,route:row.route,quotationRevisionRequestId:row.quotation_revision_request_id,draftId:row.draft_id,boqRevisionId:row.boq_revision_id};
 }
 /** Build the proposed new IPO version from the approved revised quotation. Nothing is issued yet. */
 async prepare(actor:string,requestId:string,raw:unknown){
  const v=ipoRevisionPrepareSchema.parse(raw);
  const replay=(await this.pool.query('SELECT * FROM ipo_revision_proposals WHERE request_key=$1',[v.requestKey])).rows[0];
  if(replay){if(replay.request_id!==requestId||replay.created_by!==actor)throw new HttpError(409,'This request key was used for another IPO revision.');return {id:replay.id,number:replay.number};}
  const request=(await this.pool.query('SELECT * FROM ipo_revision_requests WHERE id=$1',[requestId])).rows[0];
  if(!request)throw new HttpError(404,'IPO revision not found.');
  return transaction(this.pool,async c=>{
   const {u,r,chain,current}=await this.load(actor,request.record_id,c,true);
   if(!(u.role==='Coordinator'&&r.coordinator_id===actor)&&!management(u.role))throw new HttpError(403,'The site coordinator or Management prepares the revised IPO.');
   const row=(await this.requests(c,r.id)).find(x=>x.id===requestId)!;
   if(row.decision)throw new HttpError(409,'This IPO revision is closed. Start a new revision if more changes are needed.');
   if(row.proposal_id)throw new HttpError(409,'The revised IPO is already with Management for approval.');
   if(request.base_ipo_id!==current.id)throw new HttpError(409,'The IPO changed since this revision started. Start a new revision.');
   if(!row.revised_quotation_id)throw new HttpError(409,'Finish the revised quotation first, then prepare the revised IPO.');
   if(row.revised_quotation_status!=='Approved')throw new HttpError(409,'Management must approve the revised quotation before the revised IPO is prepared.');
   const blocked=await this.blockers(c,chain.map(i=>i.id),request.route);
   if(blocked.length)throw new HttpError(409,`This IPO cannot be revised because ${blocked.join('; ')}. Ask Management to review.`);
   const before=current.snapshot,beforeInput=before.input??{};
   const site={...r,site_code:r.canonical_site_code??r.site_code};
   const basis=await quotationBasis(this.pool,c as PoolClient,actor,site,row.revised_quotation_id,{reference:beforeInput.approvalReference||beforeInput.poNumber,date:beforeInput.orderDate,notes:beforeInput.evidenceNotes,customerNtn:beforeInput.customerNtn,customerStrn:beforeInput.customerStrn});
   if(request.route==='commercial'&&basis.boqRevisionId!==before.boqRevisionId)throw new HttpError(422,'A commercial revision must keep the original BOQ. Use the technical route for quantity changes.');
   const approvedCount=chain.length-1,number=revisedIpoNumber(chain[0].number,approvedCount+1);
   if((await c.query('SELECT 1 FROM internal_purchase_orders WHERE lower(number)=lower($1)',[number])).rowCount)throw new HttpError(409,`IPO number ${number} already exists. Ask Management to review.`);
   const panels=before.approvedPanelQty;
   const input={...basis.order.input,...(beforeInput.invoiceTerms?{invoiceTerms:beforeInput.invoiceTerms}:{}),poNumber:beforeInput.poNumber??'',approvalReference:beforeInput.approvalReference,evidenceType:beforeInput.evidenceType,orderDate:beforeInput.orderDate,evidenceNotes:beforeInput.evidenceNotes};
   const snapshot={...structuredClone(basis.order),directPoApproval:before.directPoApproval??null,siteName:before.siteName??r.site_name,siteCode:before.siteCode??site.site_code,input,
    boqRevisionId:basis.boqRevisionId,boqNumber:basis.order.boqNumber??before.boqNumber,preparedBy:r.coordinator,checkedBy:r.coordinator,workflowRecordId:r.id,approvedCommercialSource:basis.source,
    orderDecisionId:before.orderDecisionId,approvalChannel:'Approved IPO revision',documentLayoutVersion:4,approvedPanelQty:panels,peachtree:ptDetail(basis.order,basis.boq,panels),
    ipoRevision:{revision:approvedCount+1,requestId,route:request.route,reason:request.reason,originalIpoId:chain[0].id,originalNumber:chain[0].number,revisesIpoId:current.id,revisesNumber:current.number}};
   const id=randomUUID(),version=Number((await c.query('SELECT coalesce(max(version),0)+1 AS n FROM ipo_revision_proposals WHERE request_id=$1',[requestId])).rows[0].n);
   await c.query('INSERT INTO ipo_revision_proposals(id,request_id,version,quotation_id,number,snapshot,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,requestId,version,row.revised_quotation_id,number,snapshot,v.requestKey,actor]);
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`ipo.revision.prepared:${requestId}:${id}`]);
   return {id,number};
  });
 }
 /** Management queue: revised IPOs waiting for a decision, with the reason and old vs new totals. */
 async pending(actor:string){
  const u=(await this.pool.query('SELECT active,role FROM users WHERE id=$1',[actor])).rows[0];
  if(!u?.active)throw new HttpError(401,'Your access has ended.');if(!management(u.role))throw new HttpError(403,'Management approves IPO revisions.');
  const rows=(await this.pool.query(`SELECT p.id,p.number,p.snapshot,p.created_at,q.id AS request_id,q.route,q.reason,q.record_id,r.site_name,c.short_code,c.name AS customer,b.id AS base_id,b.number AS base_number,b.snapshot AS base_snapshot,u.display_name AS requested_by,v.number AS quotation_number
   FROM ipo_revision_proposals p JOIN ipo_revision_requests q ON q.id=p.request_id JOIN project_workflow_records r ON r.id=q.record_id JOIN customers c ON c.id=r.customer_id
   JOIN internal_purchase_orders b ON b.id=q.base_ipo_id JOIN users u ON u.id=q.created_by JOIN quotation_versions v ON v.id=p.quotation_id
   WHERE NOT EXISTS(SELECT 1 FROM ipo_revision_decisions d WHERE d.proposal_id=p.id) ORDER BY p.created_at`)).rows;
  return {revisions:rows.map(x=>({id:x.id,number:x.number,route:x.route,reason:x.reason,recordId:x.record_id,site:x.site_name,customer:x.short_code||x.customer,requestedBy:x.requested_by,createdAt:x.created_at,quotationNumber:x.quotation_number,
   before:{id:x.base_id,number:x.base_number,amount:amount(x.base_snapshot),footer:footer(x.base_snapshot)},after:{amount:amount(x.snapshot),footer:footer(x.snapshot)}}))};
 }
 async proposalDocument(actor:string,proposalId:string){
  const p=(await this.pool.query('SELECT p.*,q.record_id FROM ipo_revision_proposals p JOIN ipo_revision_requests q ON q.id=p.request_id WHERE p.id=$1',[proposalId])).rows[0];
  if(!p)throw new HttpError(404,'Revised IPO not found.');
  await this.workflow().record(actor,p.record_id);
  return {number:p.number,snapshot:p.snapshot};
 }
 /** Approve: issue the new IPO version (immutable) and hand it to Accounts. Return: close with a note. */
 async decide(actor:string,proposalId:string,raw:unknown){
  const v=ipoRevisionDecisionSchema.parse(raw);
  if(v.decision==='Returned'&&v.note.length<3)throw new HttpError(422,'Write why the revised IPO is returned.');
  const replay=(await this.pool.query('SELECT * FROM ipo_revision_decisions WHERE request_key=$1',[v.requestKey])).rows[0];
  if(replay){if(replay.proposal_id!==proposalId||replay.decided_by!==actor||replay.decision!==v.decision)throw new HttpError(409,'This request key was used for another decision.');return {decision:replay.decision,revisedIpoId:replay.revised_ipo_id};}
  const p=(await this.pool.query('SELECT p.*,q.record_id,q.base_ipo_id,q.route FROM ipo_revision_proposals p JOIN ipo_revision_requests q ON q.id=p.request_id WHERE p.id=$1',[proposalId])).rows[0];
  if(!p)throw new HttpError(404,'Revised IPO not found.');
  return transaction(this.pool,async c=>{
   const {u,r,chain,current}=await this.load(actor,p.record_id,c,true);
   if(!management(u.role))throw new HttpError(403,'Management approves IPO revisions.');
   if((await c.query('SELECT 1 FROM ipo_revision_decisions WHERE proposal_id=$1',[proposalId])).rowCount)throw new HttpError(409,'This revised IPO is already decided.');
   let revisedIpoId:string|null=null;
   if(v.decision==='Approved'){
    if(p.base_ipo_id!==current.id)throw new HttpError(409,'The IPO changed since this revision started. Return it and start a new revision.');
    const blocked=await this.blockers(c,chain.map(i=>i.id),p.route);
    if(blocked.length)throw new HttpError(409,`This IPO can no longer be revised because ${blocked.join('; ')}. Return the revision.`);
    const po=randomUUID();revisedIpoId=randomUUID();
    // The revised IPO gets its own PO header (the customer PO number stays in the IPO itself), so the
    // original PO header and IPO stay exactly as issued.
    await c.query('INSERT INTO customer_purchase_orders(id,quotation_id,boq_revision_id,customer_id,po_number,document_id,input,created_by) VALUES($1,$2,$3,$4,$5,NULL,$6,$7)',[po,p.quotation_id,p.snapshot.boqRevisionId,r.customer_id,'',{...p.snapshot.input,ipoRevisionOf:current.id},actor]);
    await c.query('INSERT INTO internal_purchase_orders(id,customer_po_id,submission_id,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,NULL,$3,$4,$5,$6,$7)',[revisedIpoId,po,p.number,p.snapshot,fingerprint(p.snapshot),randomUUID(),actor]);
    await c.query('INSERT INTO ipo_accounts_handoffs(id,ipo_id,created_by) VALUES($1,$2,$3)',[randomUUID(),revisedIpoId,r.coordinator_id]);
   }
   await c.query('INSERT INTO ipo_revision_decisions(proposal_id,decision,note,revised_ipo_id,request_key,decided_by) VALUES($1,$2,$3,$4,$5,$6)',[proposalId,v.decision,v.note,revisedIpoId,v.requestKey,actor]);
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`ipo.revision.${v.decision.toLowerCase()}:${proposalId}${revisedIpoId?':'+revisedIpoId:''}`]);
   return {decision:v.decision,revisedIpoId};
  });
 }
}
