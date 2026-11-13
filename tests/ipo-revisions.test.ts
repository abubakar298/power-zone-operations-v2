import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {createDashboardSamples} from '../server/coordinator/samples.js';
import {ProjectWorkflowRepository} from '../server/project-workflow/repository.js';
import {IpoRevisionRepository,revisedIpoNumber} from '../server/project-workflow/ipo-revisions.js';
import {OrdersRepository} from '../server/orders/repository.js';
import {NotificationsRepository} from '../server/notifications/repository.js';
import {buildIpoPdf} from '../server/orders/document-renderers.js';
import type {User} from '../server/auth/repository.js';

/** Stand in for the existing quotation screens: the Coordinator saves the revised quotation for the
 * revision request and Management approves it. Pricing is copied, so the order basis is valid. */
async function reviseQuotation(db:Awaited<ReturnType<typeof testDatabase>>,sourceId:string,requestId:string,actor:string){
 const id=randomUUID();
 await db.pool.query(`INSERT INTO quotation_versions(id,pricing_id,boq_revision_id,version,number,snapshot,fingerprint,request_key,created_by)
  SELECT $1,pricing_id,boq_revision_id,(SELECT max(version)+1 FROM quotation_versions WHERE boq_revision_id=q.boq_revision_id),number||'-T'||$5,snapshot,fingerprint,$2,$3 FROM quotation_versions q WHERE id=$4`,[id,randomUUID(),actor,sourceId,id.slice(0,4)]);
 await db.pool.query('INSERT INTO quotation_revision_links(quotation_id,request_id) VALUES($1,$2)',[id,requestId]);
 return id;
}
async function approve(db:Awaited<ReturnType<typeof testDatabase>>,quotationId:string,actor:string){await db.pool.query("INSERT INTO coordination_events(id,quotation_id,kind,notes,created_by,created_at) VALUES($1,$2,'Approved','Approved revised quotation',$3,clock_timestamp())",[randomUUID(),quotationId,actor]);}

test('IPO revision: reason and route, revised quotation, Management approves old vs new, new immutable IPO version to Accounts',async()=>{
 const db=await testDatabase();try{
  const users:Record<string,{id:string;role:string}>={};
  for(const [key,role] of [['owner','Coordinator'],['manager','Management'],['other','Coordinator'],['accounts','Accounts']]){users[key]={id:randomUUID(),role};await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated-test',$4)",[users[key].id,key+'@example.test',key==='owner'?'Atif':key==='manager'?'Abu Bakar':key,role]);}
  await db.pool.query("UPDATE notification_settings SET activated_at=now()-interval '1 hour'");
  const samples=await createDashboardSamples(db.pool,users.owner.id,users.manager.id);
  const source=samples.find((r:any)=>r.quotationId&&r.stage===7)!;
  const q=(await db.pool.query('SELECT q.snapshot,b.customer_id FROM quotation_versions q JOIN boq_revisions br ON br.id=q.boq_revision_id JOIN boqs b ON b.id=br.boq_id WHERE q.id=$1',[source.quotationId])).rows[0];
  const recordId=randomUUID(),workflow=new ProjectWorkflowRepository(db.pool),repo=new IpoRevisionRepository(db.pool);
  await db.pool.query("INSERT INTO project_workflow_records(id,customer_id,site_name,site_code,route,stage,coordinator_id,data,request_key,created_by) VALUES($1,$2,'IPO revision fixture',$3,'quick-quote','customer_tracking',$4,$5,$6,$4)",[recordId,q.customer_id,q.snapshot.siteCode,users.owner.id,{quotationId:source.quotationId},randomUUID()]);
  const evidence=await workflow.attach(users.owner.id,recordId,{kind:'PO / confirmation',filename:'approval.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4\n% Disposable approval\n%%EOF').toString('base64')});
  const invoiceCompany=(await new OrdersRepository(db.pool).defaults(source.quotationId)).invoiceCompany;
  const detail=await workflow.detail(users.owner.id,recordId);
  await workflow.action(users.owner.id,recordId,{version:detail.record.version,requestKey:randomUUID(),action:'receipt',input:{reference:'WA-REV-'+recordId.slice(0,8),date:'2026-10-16',evidenceId:evidence.id,basisType:'quotation',quotationId:source.quotationId,confirmationType:'WhatsApp approval',reviewed:true,notes:'Customer approval; disposable test.',saleDetails:{invoiceCompany,salesPerson:'Atif',poNumber:''}}});
  const issued=(await workflow.detail(users.owner.id,recordId)).record;assert.equal(issued.stage,'issued');
  const original=(await db.pool.query('SELECT * FROM internal_purchase_orders WHERE id=$1',[issued.data.ipoId])).rows[0],originalJson=JSON.stringify(original);

  // Locked current behaviour: one issued IPO, no revisions; only the owner or Management may start one.
  let status=await repo.status(users.owner.id,recordId);
  assert.equal(status.current.id,original.id);assert.equal(status.canStart,true);assert.deepEqual(status.revisions,[]);
  const start={route:'commercial',reason:'Customer wants prices shown with GST included.',requestKey:randomUUID()};
  await assert.rejects(repo.start(users.other.id,recordId,start));
  await assert.rejects(repo.start(users.owner.id,recordId,{...start,reason:'short'}),/at least 10/);
  const started=await repo.start(users.owner.id,recordId,start);
  assert.equal(started.route,'commercial');assert.equal(started.draftId,null,'commercial keeps the BOQ: no BOQ draft');
  assert.equal((await repo.start(users.owner.id,recordId,start)).id,started.id,'retry is safe');
  await assert.rejects(repo.start(users.owner.id,recordId,{...start,requestKey:randomUUID()}),/already in progress/);
  status=await repo.status(users.owner.id,recordId);assert.equal(status.revisions[0].status,'Revising quotation');assert.equal(status.canStart,false);

  // Prepare waits for the revised quotation and its approval.
  await assert.rejects(repo.prepare(users.owner.id,started.id,{requestKey:randomUUID()}),/Finish the revised quotation/);
  const revisedQuotation=await reviseQuotation(db,source.quotationId,started.quotationRevisionRequestId,users.owner.id);
  await assert.rejects(repo.prepare(users.owner.id,started.id,{requestKey:randomUUID()}),/must approve the revised quotation/);
  await approve(db,revisedQuotation,users.manager.id);
  const prepareKey=randomUUID(),proposal=await repo.prepare(users.owner.id,started.id,{requestKey:prepareKey});
  assert.equal(proposal.number,revisedIpoNumber(original.number,1));
  assert.equal((await repo.prepare(users.owner.id,started.id,{requestKey:prepareKey})).id,proposal.id);
  await assert.rejects(repo.prepare(users.owner.id,started.id,{requestKey:randomUUID()}),/already with Management/);
  const document=await repo.proposalDocument(users.manager.id,proposal.id);
  assert.ok(buildIpoPdf(document.snapshot,document.number+' (PROPOSED - NOT ISSUED)',document.snapshot.peachtree).length>1000);
  assert.equal(document.snapshot.ipoRevision.reason,start.reason);assert.equal(document.snapshot.ipoRevision.revisesIpoId,original.id);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM internal_purchase_orders')).rows[0].n>0,true);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM internal_purchase_orders WHERE number=$1',[proposal.number])).rows[0].n,0,'nothing is issued before approval');

  // Management sees the reason and old vs new; only Management decides.
  const pending=(await repo.pending(users.manager.id)).revisions;
  assert.equal(pending.length,1);assert.equal(pending[0].reason,start.reason);assert.equal(pending[0].before.number,original.number);assert.ok(pending[0].after.amount);
  await assert.rejects(repo.pending(users.owner.id),/Management/);
  await assert.rejects(repo.decide(users.owner.id,proposal.id,{decision:'Approved',requestKey:randomUUID()}),/Management/);
  await assert.rejects(repo.decide(users.manager.id,proposal.id,{decision:'Returned',note:'',requestKey:randomUUID()}),/why/);
  const notifications=new NotificationsRepository(db.pool);await notifications.sync();
  const asUser=(key:string)=>({id:users[key].id,role:users[key].role} as unknown as User);
  assert.equal((await notifications.list(asUser('manager'))).filter((n:any)=>n.kind==='IPO revision approval required'&&!n.resolved_at).length,1);

  const poHeaders=async()=>(await db.pool.query('SELECT count(*)::int n FROM customer_purchase_orders')).rows[0].n,headersBefore=await poHeaders();
  const decisionKey=randomUUID(),decision=await repo.decide(users.manager.id,proposal.id,{decision:'Approved',note:'',requestKey:decisionKey});
  assert.equal(decision.decision,'Approved');assert.ok(decision.revisedIpoId);
  assert.deepEqual(await repo.decide(users.manager.id,proposal.id,{decision:'Approved',note:'',requestKey:decisionKey}),decision,'retry is safe');
  const revised=(await db.pool.query('SELECT * FROM internal_purchase_orders WHERE id=$1',[decision.revisedIpoId])).rows[0];
  assert.equal(revised.number,proposal.number);assert.equal(revised.snapshot.ipoRevision.originalIpoId,original.id);
  const originalRow=(await db.pool.query('SELECT * FROM internal_purchase_orders WHERE id=$1',[original.id])).rows[0];
  assert.equal(revised.customer_po_id,originalRow.customer_po_id,'the revised IPO stays under the original customer PO');
  assert.equal(await poHeaders(),headersBefore,'no new customer PO header is created');
  // The one-IPO-per-site-per-PO guard still refuses any other second IPO under that PO.
  await assert.rejects(db.pool.query('INSERT INTO internal_purchase_orders(id,customer_po_id,submission_id,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,NULL,$3,$4,$5,$6,$7)',[randomUUID(),originalRow.customer_po_id,'TEST-DUPLICATE-IPO',originalRow.snapshot,'x',randomUUID(),users.manager.id]),/already has an IPO under the customer PO/);
  assert.equal(JSON.stringify((await db.pool.query('SELECT * FROM internal_purchase_orders WHERE id=$1',[original.id])).rows[0]),originalJson,'the original IPO is unchanged');
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM ipo_accounts_handoffs WHERE ipo_id=$1',[revised.id])).rows[0].n,1,'the revised IPO goes to Accounts');
  status=await repo.status(users.owner.id,recordId);
  assert.equal(status.current.id,revised.id);assert.equal(status.original.id,original.id);assert.equal(status.revisions[0].status,'Approved');assert.equal(status.canStart,true);
  await notifications.sync();
  assert.ok((await notifications.list(asUser('accounts'))).some((n:any)=>n.kind==='Revised IPO issued'&&n.reference.includes(revised.number)&&n.reference.includes(start.reason)));
  assert.ok((await notifications.list(asUser('owner'))).some((n:any)=>n.kind==='IPO revision approved'));
  assert.equal((await notifications.list(asUser('manager'))).filter((n:any)=>n.kind==='IPO revision approval required'&&!n.resolved_at).length,0);

  // A second revision can be returned with a note; the current IPO stays the approved R1.
  const second=await repo.start(users.owner.id,recordId,{route:'commercial',reason:'Customer asked for a different payment split.',requestKey:randomUUID()});
  const secondQuotation=await reviseQuotation(db,revisedQuotation,second.quotationRevisionRequestId,users.owner.id);await approve(db,secondQuotation,users.manager.id);
  const secondProposal=await repo.prepare(users.owner.id,second.id,{requestKey:randomUUID()});
  assert.equal(secondProposal.number,revisedIpoNumber(original.number,2));
  await repo.decide(users.manager.id,secondProposal.id,{decision:'Returned',note:'Keep the agreed payment terms.',requestKey:randomUUID()});
  status=await repo.status(users.owner.id,recordId);
  assert.equal(status.current.id,revised.id);assert.equal(status.revisions[1].status,'Returned');assert.equal(status.revisions[1].decision?.note,'Keep the agreed payment terms.');

  // Work started (PT posted on the current IPO) stops a technical revision; a commercial revision
  // is still allowed until the job has a closure record.
  await db.pool.query("INSERT INTO accounts_pt_entries(id,source_kind,source_id,source_version,pt_reference,entry_date,notes,created_by) VALUES($1,'IPO',$2,1,'PT-TEST','2026-11-13','test',$3)",[randomUUID(),revised.id,users.accounts.id]);
  await assert.rejects(repo.start(users.owner.id,recordId,{route:'technical',reason:'Quantity change after PT was posted.',requestKey:randomUUID()}),/Accounts has posted the PT/);
  status=await repo.status(users.owner.id,recordId);
  assert.deepEqual(status.blockers.commercial,[]);assert.ok(status.blockers.technical.includes('Accounts has posted the PT'));
  const afterPt=await repo.start(users.owner.id,recordId,{route:'commercial',reason:'Customer agreed a new price after PT was posted.',requestKey:randomUUID()});
  assert.equal(afterPt.route,'commercial');
  for(const table of ['ipo_revision_requests','ipo_revision_proposals','ipo_revision_decisions'])await assert.rejects(db.pool.query(`DELETE FROM ${table}`));
 }finally{await db.close();}
});
test('revised IPO numbers: CPZ references and manual CHP numbers',()=>{
 assert.equal(revisedIpoNumber('CPZ-IPO-26-012-0005-003 (ELEN-FSD1)',1),'CPZ-IPO-26-012-0005-003-R1 (ELEN-FSD1)');
 assert.equal(revisedIpoNumber('CPZ-IPO-26-012-0005-003-R1 (ELEN-FSD1)',2),'CPZ-IPO-26-012-0005-003-R2 (ELEN-FSD1)');
 assert.equal(revisedIpoNumber('CHP-351',1),'CHP-351-R1');
 assert.equal(revisedIpoNumber('CHP-351',2),'CHP-351-R2');
});
