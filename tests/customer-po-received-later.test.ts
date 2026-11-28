import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {ProjectWorkflowRepository} from '../server/project-workflow/repository.js';
import {attachedPoByIpo,customerPoFollowUps,latePoFileKind} from '../server/project-workflow/late-customer-po.js';
import {directPoSuggestions} from '../shared/direct-po-reading.js';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const pdf=(text:string)=>Buffer.from('%PDF-1.4 '+text).toString('base64');

async function fixture(){
 const previous=process.env.ENABLE_DEFERRED_UPS_WORKFLOW;process.env.ENABLE_DEFERRED_UPS_WORKFLOW='true';
 const db=await testDatabase();
 const actor=randomUUID();
 await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Atif late PO test','Coordinator','isolated-only')",[actor,actor+'@test.invalid']);
 const repo=new ProjectWorkflowRepository(db.pool);
 const ubl=(await db.pool.query("SELECT * FROM project_framework_current WHERE configuration_key='UBL-UPS-6-10'")).rows[0];
 async function prepare(code:string,f=ubl){
  const record=await repo.create(actor,{requestKey:randomUUID(),customerId:f.customer_id,siteName:'Late PO branch '+code,siteCode:code,route:'direct-framework',frameworkId:f.id,notes:'Isolated customer PO received later test'});
  const file=await repo.attach(actor,record.id,{kind:'PO / confirmation',filename:'approval-'+code+'.png',mime:'image/png',base64:png});
  return {id:record.id,file,f};
 }
 function receipt(site:{file:any;f:any},code:string,type:string,extra:Record<string,unknown>={}){
  return {reference:(type==='Email approval'?'EMAIL-':'WA-')+code,date:'2026-11-20',evidenceId:site.file.id,basisType:'framework',frameworkId:site.f.id,ipoNumber:'CHP-LATE-'+code,confirmationType:type,saleDetails:{orderNumber:'',invoiceCompany:'PZES (PVT Ltd)',salesPerson:'Waqas ul Haq',evidenceNotes:'Branch approval received from the customer'},reviewed:true,notes:'Customer approved the branch in writing',...extra};
 }
 async function confirm(site:{id:string;file:any;f:any},code:string,type:string,extra:Record<string,unknown>={}){
  const detail=await repo.detail(actor,site.id);
  return repo.action(actor,site.id,{version:detail.record.version,requestKey:randomUUID(),action:'receipt',input:receipt(site,code,type,extra)});
 }
 const close=async()=>{await db.close();if(previous===undefined)delete process.env.ENABLE_DEFERRED_UPS_WORKFLOW;else process.env.ENABLE_DEFERRED_UPS_WORKFLOW=previous;};
 return {db,actor,repo,ubl,prepare,receipt,confirm,close};
}

test('approval proof issues the IPO without a customer PO number; Email approval now works for every agreement',async()=>{
 const t=await fixture();
 try{
  const site=await t.prepare('LATE-WA');
  const result=await t.confirm(site,'LATE-WA','WhatsApp approval');
  assert.equal(result.stage,'issued');
  const ipo=(await t.db.pool.query('SELECT * FROM internal_purchase_orders WHERE number=$1',['CHP-LATE-LATE-WA'])).rows[0];
  assert.equal(ipo.snapshot.input.poNumber,'');
  assert.equal(ipo.snapshot.input.evidenceType,'WhatsApp approval');
  assert.equal(ipo.snapshot.input.approvalReference,'WA-LATE-WA');
  assert.ok((await t.db.pool.query('SELECT 1 FROM operations_boq_issuances WHERE ipo_id=$1',[ipo.id])).rowCount,'Operations receives the BOQ at once');
  assert.equal((await t.repo.detail(t.actor,site.id)).record.data.poToFollow,false,'No PO-pending label unless Coordination says a PO will follow');
  // Before this change Email approval was refused for every agreement except Meezan UPS (locked on main first).
  const email=await t.prepare('LATE-EM');
  assert.equal((await t.repo.salePreview(t.actor,email.id,t.receipt(email,'LATE-EM','Email approval'))).input.evidenceType,'Email approval');
  const values={...directPoSuggestions(''),siteCode:'LATE-EM',siteName:'Late PO branch LATE-EM',approvalDate:'2026-11-20'};
  const detail=await t.repo.detail(t.actor,email.id);
  await t.repo.action(t.actor,email.id,{version:detail.record.version,requestKey:randomUUID(),action:'save-direct-po-details',input:{evidenceId:email.file.id,evidenceType:'Email approval',extracted:values,values,notes:'UBL email approval reviewed'}});
  assert.equal((await t.repo.detail(t.actor,email.id)).record.data.directPoDetails.evidenceType,'Email approval');
 }finally{await t.close();}
});

test('a customer PO received later is a new versioned record; the issued IPO stays unchanged',async()=>{
 const t=await fixture();
 try{
  const site=await t.prepare('LATE-PO');
  await assert.rejects(t.repo.attach(t.actor,site.id,{kind:latePoFileKind,filename:'early.png',mime:'image/png',base64:png}),/after the IPO is issued/);
  const basis=(await t.db.pool.query('SELECT data FROM project_workflow_records WHERE id=$1',[site.id])).rows[0].data.basis;
  await assert.rejects(t.confirm(site,'LATE-PO','Customer PO',{poToFollow:true,reference:'PO-NOT-SAVED',actual:basis.comparison}),/only for email or WhatsApp/);
  await t.confirm(site,'LATE-PO','Email approval',{poToFollow:true});
  const ipoBefore=(await t.db.pool.query('SELECT * FROM internal_purchase_orders WHERE number=$1',['CHP-LATE-LATE-PO'])).rows[0];
  const frozen=JSON.stringify(ipoBefore.snapshot);
  const count=async(table:string)=>(await t.db.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  const counts=async()=>({ipos:await count('internal_purchase_orders'),pos:await count('customer_purchase_orders'),receipts:await count('project_po_receipts')});
  const before=await counts();
  let detail=await t.repo.detail(t.actor,site.id);
  assert.equal(detail.record.data.poToFollow,true);assert.equal(detail.record.data.approvalEvidenceType,'Email approval');assert.equal(detail.record.data.latePo,null);
  await assert.rejects(t.repo.attach(t.actor,site.id,{kind:'Request evidence',filename:'other.png',mime:'image/png',base64:png}),/This document is with Accounts/);
  const file=await t.repo.attach(t.actor,site.id,{kind:latePoFileKind,filename:'customer-po.pdf',mime:'application/pdf',base64:pdf('late customer PO')});
  const attach=(input:Record<string,unknown>,version=detail.record.version)=>t.repo.action(t.actor,site.id,{version,requestKey:randomUUID(),action:'attach-late-po',input:{fileId:file.id,poDate:'2026-11-28',notes:'Formal PO received by email',...input}});
  await assert.rejects(attach({poNumber:'N/A'}),/customer PO number/);
  await assert.rejects(attach({poNumber:'4500123',fileId:site.file.id}),/Upload the customer PO file/);
  // The site's Operations Board record (read by Operations, Store documents and Accounts) gets the attached PO.
  const boardId='live-ipo:'+ipoBefore.id;
  const boardBefore=(await t.db.pool.query('SELECT version,snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[boardId])).rows[0];
  assert.ok(boardBefore,'Issuing the IPO created its Operations Board site');
  assert.notEqual(boardBefore.snapshot.customerPo,'4500123');
  const first=await attach({poNumber:'4500123',poAmount:ipoBefore.snapshot.allocation.total});
  assert.equal(first.stage,'issued');
  detail=await t.repo.detail(t.actor,site.id);
  assert.equal(detail.record.data.latePo.poNumber,'4500123');assert.equal(detail.record.data.latePo.version,1);
  assert.equal(detail.record.data.latePo.amountDiffers,false);assert.equal(detail.record.data.latePo.byName,'Atif late PO test');
  await assert.rejects(attach({poNumber:'4500124'},first.version-1),/changed/);
  await attach({poNumber:'4500124',poAmount:'1.00',notes:'Corrected: customer re-issued the PO'});
  detail=await t.repo.detail(t.actor,site.id);
  assert.equal(detail.record.data.latePo.version,2);assert.equal(detail.record.data.latePo.amountDiffers,true);assert.equal(detail.record.data.latePoVersions.length,2);
  const board=(await t.db.pool.query('SELECT version,snapshot,action FROM operations_board_versions WHERE site_id=$1 ORDER BY version',[boardId])).rows;
  assert.deepEqual(board.slice(-2).map((b:any)=>[b.version,b.snapshot.customerPo,b.action]),[[boardBefore.version+1,'4500123','Customer PO updated'],[boardBefore.version+2,'4500124','Customer PO updated']],'Each attached PO is a new board version');
  assert.equal(board.find((b:any)=>b.version===boardBefore.version).snapshot.customerPo,boardBefore.snapshot.customerPo,'Earlier board versions stay unchanged');
  assert.equal((await t.db.pool.query("SELECT count(*)::int AS n FROM operations_board_events WHERE site_id=$1 AND kind='Customer PO updated'",[boardId])).rows[0].n,2);
  assert.equal((await attachedPoByIpo(t.db.pool,[ipoBefore.id])).get(ipoBefore.id),'4500124');
  const rows=(await t.db.pool.query('SELECT * FROM project_late_customer_pos WHERE record_id=$1 ORDER BY version',[site.id])).rows;
  assert.deepEqual(rows.map((r:any)=>[r.version,r.po_number,r.amount_differs,r.created_by]),[[1,'4500123',false,t.actor],[2,'4500124',true,t.actor]]);
  assert.equal(rows[0].ipo_id,ipoBefore.id);assert.equal(rows[0].file_id,file.id);
  await assert.rejects(t.db.pool.query("UPDATE project_late_customer_pos SET po_number='EDITED' WHERE record_id=$1",[site.id]),/immutable/);
  await assert.rejects(t.db.pool.query('DELETE FROM project_late_customer_pos WHERE record_id=$1',[site.id]),/immutable/);
  const ipoAfter=(await t.db.pool.query('SELECT snapshot FROM internal_purchase_orders WHERE id=$1',[ipoBefore.id])).rows[0];
  assert.equal(JSON.stringify(ipoAfter.snapshot),frozen,'Issued IPO is byte-for-byte unchanged');
  assert.deepEqual(await counts(),before,'No IPO, customer PO or receipt row is created or replaced');
  assert.equal((await t.db.pool.query("SELECT count(*)::int AS n FROM project_workflow_events WHERE record_id=$1 AND action='attach-late-po'",[site.id])).rows[0].n,2);
  assert.equal((await t.db.pool.query('SELECT count(*)::int AS n FROM audit_log WHERE action LIKE $1',['project.workflow.attach-late-po:'+site.id+'%'])).rows[0].n,2);
  const followUps=await customerPoFollowUps(t.db.pool,[site.id]);
  assert.equal(followUps.get(site.id)?.poToFollow,true);assert.equal(followUps.get(site.id)?.latePo.poNumber,'4500124');
  // Accounts reads issued sites already, so it can open the received-later PO; it cannot attach one.
  const accounts=randomUUID();
  await t.db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Accounts late PO test','Accounts','isolated-only')",[accounts,accounts+'@test.invalid']);
  assert.equal((await t.repo.file(accounts,site.id,file.id)).filename,'customer-po.pdf');
  await assert.rejects(t.repo.attach(accounts,site.id,{kind:latePoFileKind,filename:'acc.png',mime:'image/png',base64:png}),/cannot perform this action/);
 }finally{await t.close();}
});

test('a received-later PO is refused for customer-PO sites and for a PO number used by another site',async()=>{
 const t=await fixture();
 try{
  const po=await t.prepare('LATE-CPO');
  const basis=(await t.db.pool.query('SELECT data FROM project_workflow_records WHERE id=$1',[po.id])).rows[0].data.basis;
  await t.confirm(po,'LATE-CPO','Customer PO',{reference:'UBL-PO-777',actual:basis.comparison});
  await assert.rejects(t.repo.attach(t.actor,po.id,{kind:latePoFileKind,filename:'po.png',mime:'image/png',base64:png}),/issued on a customer PO/);
  const a=await t.prepare('LATE-A'),b=await t.prepare('LATE-B');
  await t.confirm(a,'LATE-A','WhatsApp approval',{poToFollow:true});
  await t.confirm(b,'LATE-B','WhatsApp approval',{poToFollow:true});
  async function attach(site:{id:string},poNumber:string){
   const file=await t.repo.attach(t.actor,site.id,{kind:latePoFileKind,filename:'po-'+poNumber+'.pdf',mime:'application/pdf',base64:pdf(poNumber+' '+site.id+' '+randomUUID())});
   const detail=await t.repo.detail(t.actor,site.id);
   return t.repo.action(t.actor,site.id,{version:detail.record.version,requestKey:randomUUID(),action:'attach-late-po',input:{fileId:file.id,poNumber,poDate:'2026-11-28',notes:'Received PO'}});
  }
  await attach(a,'PO-SHARED');
  await assert.rejects(attach(b,'po-shared'),/another site/);
  await assert.rejects(attach(b,'UBL-PO-777'),/another site/);
  await attach(a,'PO-SHARED');
  const other=randomUUID();
  await t.db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Other coordinator','Coordinator','isolated-only')",[other,other+'@test.invalid']);
  await assert.rejects(t.repo.attach(other,b.id,{kind:latePoFileKind,filename:'x.png',mime:'image/png',base64:png}),/not available/);
 }finally{await t.close();}
});
