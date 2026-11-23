import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {createDashboardSamples} from '../server/coordinator/samples.js';
import {CoordinatorRepository} from '../server/coordinator/repository.js';
import {ProjectWorkflowRepository} from '../server/project-workflow/repository.js';
import {IpoRevisionRepository,revisedIpoNumber} from '../server/project-workflow/ipo-revisions.js';
import {OrdersRepository} from '../server/orders/repository.js';
import {buildIpoPdf} from '../server/orders/document-renderers.js';
import {requireOwnedResource} from '../server/http/permissions.js';

type Db=Awaited<ReturnType<typeof testDatabase>>;
/** Stand in for the quotation screens: the Coordinator saves the revised quotation and submits it. */
async function submitRevisedQuotation(db:Db,sourceId:string,requestId:string,actor:string){
 const id=randomUUID();
 await db.pool.query(`INSERT INTO quotation_versions(id,pricing_id,boq_revision_id,version,number,snapshot,fingerprint,request_key,created_by)
  SELECT $1,pricing_id,boq_revision_id,(SELECT max(version)+1 FROM quotation_versions WHERE boq_revision_id=q.boq_revision_id),number||'-T'||$5,snapshot,fingerprint,$2,$3 FROM quotation_versions q WHERE id=$4`,[id,randomUUID(),actor,sourceId,id.slice(0,4)]);
 await db.pool.query('INSERT INTO quotation_revision_links(quotation_id,request_id) VALUES($1,$2)',[id,requestId]);
 await db.pool.query("INSERT INTO coordination_events(id,quotation_id,kind,notes,created_by,created_at) VALUES($1,$2,'Submitted','Revised quotation for IPO revision',$3,clock_timestamp())",[randomUUID(),id,actor]);
 return id;
}
const status=async(db:Db,quotationId:string)=>(await db.pool.query('SELECT kind FROM coordination_events WHERE quotation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[quotationId])).rows[0]?.kind;

test('IPO revision, one approval: the submitted revised quotation and the revised IPO are approved together on the IPO revisions card',async()=>{
 const db=await testDatabase();try{
  const users:Record<string,string>={};
  for(const [key,role] of [['owner','Coordinator'],['manager','Management'],['other','Coordinator']]){users[key]=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated-test',$4)",[users[key],key+'@example.test',key==='owner'?'Atif':'Abu Bakar',role]);}
  const samples=await createDashboardSamples(db.pool,users.owner,users.manager);
  const source=samples.find((r:any)=>r.quotationId&&r.stage===7)!;
  const q=(await db.pool.query('SELECT q.snapshot,b.customer_id FROM quotation_versions q JOIN boq_revisions br ON br.id=q.boq_revision_id JOIN boqs b ON b.id=br.boq_id WHERE q.id=$1',[source.quotationId])).rows[0];
  const recordId=randomUUID(),workflow=new ProjectWorkflowRepository(db.pool),repo=new IpoRevisionRepository(db.pool),coordinator=new CoordinatorRepository(db.pool);
  await db.pool.query("INSERT INTO project_workflow_records(id,customer_id,site_name,site_code,route,stage,coordinator_id,data,request_key,created_by) VALUES($1,$2,'One approval fixture',$3,'quick-quote','customer_tracking',$4,$5,$6,$4)",[recordId,q.customer_id,q.snapshot.siteCode,users.owner,{quotationId:source.quotationId},randomUUID()]);
  const evidence=await workflow.attach(users.owner,recordId,{kind:'PO / confirmation',filename:'approval.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4\n% Disposable approval\n%%EOF').toString('base64')});
  const invoiceCompany=(await new OrdersRepository(db.pool).defaults(source.quotationId)).invoiceCompany;
  const detail=await workflow.detail(users.owner,recordId);
  await workflow.action(users.owner,recordId,{version:detail.record.version,requestKey:randomUUID(),action:'receipt',input:{reference:'WA-ONE-'+recordId.slice(0,8),date:'2026-10-16',evidenceId:evidence.id,basisType:'quotation',quotationId:source.quotationId,confirmationType:'WhatsApp approval',reviewed:true,notes:'Customer approval; disposable test.',saleDetails:{invoiceCompany,salesPerson:'Atif',poNumber:''}}});
  const original=(await db.pool.query('SELECT * FROM internal_purchase_orders WHERE id=$1',[(await workflow.detail(users.owner,recordId)).record.data.ipoId])).rows[0],originalJson=JSON.stringify(original);
  const ipoCount=async()=>(await db.pool.query('SELECT count(*)::int n FROM internal_purchase_orders')).rows[0].n;
  const quotationCard=async()=>(await coordinator.overview(users.manager,true)).tasks.filter((t:any)=>t.stage==='Quotation approval'&&t.status==='Awaiting quotation approval'&&!t.ipoRevision).map((t:any)=>t.id);

  // 1) Atif starts the revision and submits the revised quotation. Nothing else is needed from him.
  const started=await repo.start(users.owner,recordId,{route:'commercial',reason:'Accounts needs separate amounts to be shown.',requestKey:randomUUID()});
  const revised=await submitRevisedQuotation(db,source.quotationId,started.quotationRevisionRequestId,users.owner);
  let s=await repo.status(users.owner,recordId);
  assert.equal(s.revisions[0].status,'Awaiting Management approval','with Management as soon as the revised quotation is submitted');
  assert.equal(s.revisions[0].proposal,null);

  // 2) It is not on Management's Quotations card; it is on the IPO revisions card, with old vs new and a preview.
  assert.ok(!(await quotationCard()).includes(revised),'not on the Quotations card');
  const pending=(await repo.pending(users.manager)).revisions;
  assert.equal(pending.length,1);const row=pending[0];
  assert.equal(row.kind,'quotation');assert.equal(row.id,started.id);assert.equal(row.quotationId,revised);assert.equal(row.previewError,null);
  assert.equal(row.number,revisedIpoNumber(original.number,1));assert.equal(row.before.number,original.number);assert.ok(row.after.amount,'new amount shown');
  const preview=await repo.submittedDocument(users.manager,started.id);
  assert.ok(buildIpoPdf(preview.snapshot,preview.number+' (PROPOSED - NOT ISSUED)',preview.snapshot.peachtree).length>1000);
  assert.equal(await status(db,revised),'Submitted','the preview never saves an approval');
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM coordination_events WHERE quotation_id=$1 AND kind='Approved'",[revised])).rows[0].n,0);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM ipo_revision_proposals')).rows[0].n,0,'nothing is prepared before the decision');
  const before=await ipoCount();

  // 3) Only Management decides; the old Prepare step is not needed (and not possible) while the quotation waits.
  await assert.rejects(repo.decideSubmitted(users.owner,started.id,{decision:'Approved',requestKey:randomUUID()}),/Management/);
  await assert.rejects(repo.prepare(users.owner,started.id,{requestKey:randomUUID()}),/must approve the revised quotation/);
  await assert.rejects(repo.decideSubmitted(users.manager,started.id,{decision:'Returned',note:'',requestKey:randomUUID()}),/why/);

  // 4) One approval: the quotation is approved and the revised IPO is issued to Accounts.
  const key=randomUUID(),decision=await repo.decideSubmitted(users.manager,started.id,{decision:'Approved',note:'',requestKey:key});
  assert.equal(decision.decision,'Approved');assert.ok(decision.revisedIpoId);
  assert.deepEqual(await repo.decideSubmitted(users.manager,started.id,{decision:'Approved',note:'',requestKey:key}),decision,'retry is safe');
  assert.equal(await status(db,revised),'Approved','the revised quotation is approved by the same click');
  assert.equal(await ipoCount(),before+1);
  const issued=(await db.pool.query('SELECT * FROM internal_purchase_orders WHERE id=$1',[decision.revisedIpoId])).rows[0];
  assert.equal(issued.number,revisedIpoNumber(original.number,1));assert.equal(issued.customer_po_id,original.customer_po_id);
  assert.equal(issued.snapshot.approvedCommercialSource.id,revised,'built from the revised quotation');
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM ipo_accounts_handoffs WHERE ipo_id=$1',[issued.id])).rows[0].n,1,'sent to Accounts');
  assert.equal(JSON.stringify((await db.pool.query('SELECT * FROM internal_purchase_orders WHERE id=$1',[original.id])).rows[0]),originalJson,'the original IPO is unchanged');
  s=await repo.status(users.owner,recordId);
  assert.equal(s.current.id,issued.id);assert.equal(s.revisions[0].status,'Approved');assert.equal(s.canStart,true);
  // The Management approver creates the revised IPO, yet the site's Coordinator must be able to open its PDF
  // (IPOs Shared → Preview / Download). Every Coordinator may open approved revised IPOs (user decision);
  // the original IPO keeps its existing rule (its creator only).
  await requireOwnedResource(db.pool,users.owner,'ipo',issued.id);
  await requireOwnedResource(db.pool,users.other,'ipo',issued.id);
  await assert.rejects(requireOwnedResource(db.pool,users.other,'ipo',original.id),/not found|unavailable/i);
  assert.deepEqual((await repo.pending(users.manager)).revisions,[]);

  // 5) Return: the quotation goes back to Atif as "Changes requested"; nothing is issued; a new revision can start.
  const second=await repo.start(users.owner,recordId,{route:'commercial',reason:'Customer asked for a different payment split.',requestKey:randomUUID()});
  const secondQuotation=await submitRevisedQuotation(db,revised,second.quotationRevisionRequestId,users.owner);
  const ipos=await ipoCount();
  await repo.decideSubmitted(users.manager,second.id,{decision:'Returned',note:'Keep the agreed payment terms.',requestKey:randomUUID()});
  assert.equal(await status(db,secondQuotation),'Changes requested');
  assert.equal(await ipoCount(),ipos,'nothing is issued on return');
  s=await repo.status(users.owner,recordId);
  assert.equal(s.current.id,issued.id);assert.equal(s.revisions[1].status,'Returned');assert.equal(s.revisions[1].decision?.note,'Keep the agreed payment terms.');assert.equal(s.canStart,true);
  await assert.rejects(repo.decideSubmitted(users.manager,second.id,{decision:'Approved',requestKey:randomUUID()}),/already decided/);
 }finally{await db.close();}
});
