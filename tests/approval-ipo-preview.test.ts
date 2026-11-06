import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {createDashboardSamples} from '../server/coordinator/samples.js';
import {ProjectWorkflowRepository} from '../server/project-workflow/repository.js';
import {OrdersRepository} from '../server/orders/repository.js';
import {orderSchema} from '../server/orders/schema.js';
import {buildIpoPdf} from '../server/orders/report.js';
import {buildPeachtreePdf} from '../server/orders/peachtree-report.js';

test('quotation WhatsApp approval previews IPO and PT with blank or N/A PO reference, without issuing or reserving numbers',async()=>{
 const db=await testDatabase();try{
  const owner=randomUUID(),manager=randomUUID();
  for(const[id,role]of [[owner,'Coordinator'],[manager,'Management']])await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated-test',$4)",[id,id+'@example.test',role,role]);
  const samples=await createDashboardSamples(db.pool,owner,manager);
  const source=samples.find((r:any)=>r.quotationId&&r.stage===7)!;
  const q=(await db.pool.query('SELECT q.snapshot,b.customer_id FROM quotation_versions q JOIN boq_revisions br ON br.id=q.boq_revision_id JOIN boqs b ON b.id=br.boq_id WHERE q.id=$1',[source.quotationId])).rows[0];
  const id=randomUUID(),repo=new ProjectWorkflowRepository(db.pool);
  await db.pool.query("INSERT INTO project_workflow_records(id,customer_id,site_name,site_code,route,stage,coordinator_id,data,request_key,created_by) VALUES($1,$2,'Approval preview fixture',$3,'quick-quote','customer_tracking',$4,$5,$6,$4)",[id,q.customer_id,q.snapshot.siteCode,owner,{quotationId:source.quotationId},randomUUID()]);
  const evidence=await repo.attach(owner,id,{kind:'PO / confirmation',filename:'approval.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4\n% Disposable WhatsApp evidence\n%%EOF').toString('base64')});
  const counts=async()=>(await db.pool.query('SELECT (SELECT count(*) FROM internal_purchase_orders) AS ipos,(SELECT count(*) FROM document_reference_roots) AS refs,(SELECT count(*) FROM project_po_receipts) AS receipts')).rows[0];
  const before=await counts(),original=JSON.stringify(q.snapshot);
  const invoiceCompany=(await new OrdersRepository(db.pool).defaults(source.quotationId)).invoiceCompany;
  for(const poNumber of ['','N/A'])for(const ipoNumber of [undefined,'CHP-PREVIEW-ONLY']){
   const snapshot=await repo.salePreview(owner,id,{reference:'WA-FIXTURE-'+id,date:'2026-10-16',evidenceId:evidence.id,basisType:'quotation',quotationId:source.quotationId,confirmationType:'WhatsApp approval',ipoNumber,reviewed:true,notes:'Customer approval through WhatsApp; no formal purchase order.',saleDetails:{invoiceCompany,salesPerson:'Waqas ul Haq',poNumber}});
   assert.equal(snapshot.input.poNumber,poNumber);assert.equal(snapshot.input.evidenceType,'WhatsApp approval');
   assert.ok(buildIpoPdf(snapshot,'DRAFT - NOT ISSUED').length>1000);
   assert.ok(buildPeachtreePdf(snapshot,snapshot.peachtree,'DRAFT - NOT ISSUED').length>1000);
  }
  const used=(await db.pool.query('SELECT number FROM internal_purchase_orders LIMIT 1')).rows[0].number;
  await assert.rejects(repo.salePreview(owner,id,{reference:'WA-FIXTURE-'+id,date:'2026-10-16',evidenceId:evidence.id,basisType:'quotation',quotationId:source.quotationId,confirmationType:'WhatsApp approval',ipoNumber:used,reviewed:true,notes:'Disposable duplicate check'}),/already in use/);
  assert.deepEqual(await counts(),before);
  assert.equal(JSON.stringify((await db.pool.query('SELECT snapshot FROM quotation_versions WHERE id=$1',[source.quotationId])).rows[0].snapshot),original);
  const orders=new OrdersRepository(db.pool);
  const input=orderSchema.parse({quotationId:source.quotationId,evidenceType:'WhatsApp approval',poNumber:'N/A',ipoNumber:'CHP-APPROVAL-TEST',evidenceNotes:'Disposable customer WhatsApp approval',orderDate:'2026-10-16',invoiceCompany,salesPerson:'Waqas ul Haq',customerAccepted:true});
  const draft=await orders.preview(owner,input),key=randomUUID();
  const issued=await orders.save(manager,input,draft.fingerprint,key,owner);
  assert.equal(issued.number,'CHP-APPROVAL-TEST');
  assert.equal((await orders.save(manager,input,draft.fingerprint,key,owner)).id,issued.id,'Safe confirmation retry must reuse the issued document');
  assert.equal((await db.pool.query('SELECT po_number FROM customer_purchase_orders WHERE id=$1',[issued.customer_po_id])).rows[0].po_number,'','N/A must not reserve a formal PO reference');
  assert.equal(issued.snapshot.input.poNumber,'N/A');
  assert.equal((await orders.preview(manager,input,db.pool,true)).snapshot.allocation.total,draft.snapshot.allocation.total,'Issued manual numbers must remain readable in reporting');
  await assert.rejects(orders.preview(owner,input),/already in use/);
 }finally{await db.close();}
});

test('approval entry keeps formal PO validation and accepts optional manual IPO references',()=>{
 const base={quotationId:randomUUID(),evidenceNotes:'Approved on WhatsApp',evidenceType:'WhatsApp approval',orderDate:'2026-10-16',invoiceCompany:'PZES',salesPerson:'Waqas ul Haq',customerAccepted:true};
 for(const poNumber of ['','N/A'])assert.equal(orderSchema.safeParse({...base,poNumber}).success,true);
 assert.equal(orderSchema.parse({...base,ipoNumber:'338'}).ipoNumber,'CHP-338');
 assert.equal(orderSchema.safeParse({...base,ipoNumber:''}).success,true);
 assert.equal(orderSchema.safeParse({...base,ipoNumber:'bad@reference'}).success,false);
 assert.equal(orderSchema.safeParse({...base,evidenceType:'Customer PO',poNumber:''}).success,false);
 assert.equal(Object.hasOwn(orderSchema.parse(base),'ipoNumber'),false,'Do not add new properties to historical inputs');
});
