import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {testDatabase} from './database.js';
import {ProjectWorkflowRepository} from '../server/project-workflow/repository.js';
import {OrdersRepository} from '../server/orders/repository.js';
import {ptDisplayRows} from '../server/orders/pt-detail.js';
import {manualIpoAvailable} from '../server/documents/manual-ipo.js';

test('Direct UPS PO uses correct LV configuration, four proportional PT phases, manual number uniqueness and immutable accepted totals',async()=>{
 const previous=process.env.ENABLE_DEFERRED_UPS_WORKFLOW;process.env.ENABLE_DEFERRED_UPS_WORKFLOW='true';
 const db=await testDatabase();
 try{
  const actor=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Atif test','Coordinator','isolated-only')",[actor,actor+'@test.invalid']);
  const repo=new ProjectWorkflowRepository(db.pool),orders=new OrdersRepository(db.pool);
  const referenceFramework=(await db.pool.query("SELECT id FROM project_framework_current WHERE configuration_key='MBL-UPS-6-5'")).rows[0];
  const referenceId=randomUUID(),referenceBytes=Buffer.from('%PDF-1.4 reference-only');
  await db.pool.query('INSERT INTO framework_reference_attachments(id,framework_id,filename,mime,content,sha256,summary,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[referenceId,referenceFramework.id,'60 Units.pdf','application/pdf',referenceBytes,createHash('sha256').update(referenceBytes).digest('hex'),{quantity:60,purpose:'reference'},actor]);
  const refs=await repo.references(actor);
  assert.equal(refs.frameworkAttachments[0].framework_id,referenceFramework.id);
  assert.ok((await repo.frameworkReferenceAttachment(actor,referenceId)).content.equals(referenceBytes));
  assert.equal((await db.pool.query('SELECT count(*) AS n FROM project_workflow_records')).rows[0].n,'0');
  const expected=[['MBL-UPS-6-5','660000.00','1'],['MBL-UPS-6-10','935000.00','2'],['UBL-UPS-6-10','900000.00','2']];
  for(let n=0;n<expected.length;n++){
   const [key,gross,batteries]=expected[n];
   const f=(await db.pool.query('SELECT * FROM project_framework_current WHERE configuration_key=$1',[key])).rows[0];assert.ok(f);
   const record=await repo.create(actor,{requestKey:randomUUID(),customerId:f.customer_id,siteName:'Disposable UPS branch '+n,siteCode:'UPS-TEST-'+n,route:'direct-framework',frameworkId:f.id,notes:'Isolated Direct PO test'});
   const detail=await repo.detail(actor,record.id);
   const basis=(await db.pool.query('SELECT data FROM project_workflow_records WHERE id=$1',[record.id])).rows[0].data.basis;
   assert.equal(basis.order.allocation.total,gross);
   assert.equal(basis.boq.lines.find((l:any)=>l.itemId==='CH-BAT-LV-05 KW').qty,batteries);
   assert.ok(basis.boq.lines.some((l:any)=>l.itemId==='CH-BMS-LV'));
   assert.ok(!basis.boq.lines.some((l:any)=>/CH-BAT-HV|CH-BMS-HV/.test(l.itemId)));
   const file=await repo.attach(actor,record.id,{kind:'PO / confirmation',filename:'UPS-PO.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4 isolated-test-evidence').toString('base64')});
   const input={reference:'DIRECT-UPS-PO-'+n,date:'2026-10-15',evidenceId:file.id,basisType:'framework',frameworkId:f.id,ipoNumber:'CHP-UPS-TEST-'+n,actual:basis.comparison,confirmationType:'Customer PO',saleDetails:{invoiceCompany:'PZES (PVT Ltd)',salesPerson:'Waqas ul Haq',evidenceNotes:'Isolated test'},reviewed:true,notes:'Exact accepted agreement'};
   if(n>0)await assert.rejects(repo.salePreview(actor,record.id,{...input,ipoNumber:"CHP-UPS-TEST-0"}),/already in use/);
   const draft=await repo.salePreview(actor,record.id,input);
   const phases=ptDisplayRows(draft.peachtree);
   assert.deepEqual(phases.map((p:any)=>p.name),['Inverter','Batteries','BMS','Installations']);assert.equal(phases[3].itemId,'CH-Installations');
   assert.ok(draft.allocation.lines[0].description.includes((batteries==='1'?'5':'10')+' kWh'));
   assert.equal(phases.reduce((s:Decimal,p:any)=>s.plus(p.amount),new Decimal(0)).plus(draft.peachtree.ipoTax).toFixed(2),gross);
   // The same cost share determines each net selling amount; GST is not margin.
   const inverterCost=new Decimal(basis.boq.lines.find((l:any)=>l.itemId==='CH-PCS-HYB-SP-006').total);
   assert.equal(new Decimal(basis.order.allocation.subtotal).mul(inverterCost).div(basis.boq.total).toFixed(2),phases[0].amount);
   await repo.action(actor,record.id,{version:detail.record.version,requestKey:randomUUID(),action:'receipt',input});
   const ipo=(await db.pool.query('SELECT * FROM internal_purchase_orders WHERE number=$1',[input.ipoNumber])).rows[0];assert.ok(ipo);assert.equal(ipo.snapshot.allocation.total,gross);assert.equal(ptDisplayRows(ipo.snapshot.peachtree).length,4);
   const loaded=await orders.get(ipo.id);assert.equal(loaded.snapshot.input.poNumber,input.reference);
   assert.equal(await manualIpoAvailable(db.pool,input.ipoNumber),false);
   await assert.rejects(repo.salePreview(actor,record.id,{...input,ipoNumber:input.ipoNumber}),/preview-only/);
  }
  assert.equal(await manualIpoAvailable(db.pool,'298'),false); // original UBL IPO retained
 }finally{await db.close();if(previous===undefined)delete process.env.ENABLE_DEFERRED_UPS_WORKFLOW;else process.env.ENABLE_DEFERRED_UPS_WORKFLOW=previous;}
});


test('production defaults hide and reject deferred Direct UPS creation without changing existing solar routes',async()=>{
 const previous=process.env.ENABLE_DEFERRED_UPS_WORKFLOW;delete process.env.ENABLE_DEFERRED_UPS_WORKFLOW;
 const db=await testDatabase();try{
 const actor=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Atif test','Coordinator','isolated-only')",[actor,actor+'@test.invalid']);
 const repo=new ProjectWorkflowRepository(db.pool),f=(await db.pool.query("SELECT * FROM project_framework_current WHERE configuration_key='MBL-UPS-6-5'")).rows[0];
 const refs=await repo.references(actor);assert.equal(refs.features.directPoUps,false);assert.ok(!refs.frameworks.some((x:any)=>x.type==='bank-ups'));
 await assert.rejects(repo.create(actor,{requestKey:randomUUID(),customerId:f.customer_id,siteName:'Deferred fixture',siteCode:'UPS-DEFERRED',notes:'Deferred release fixture',route:'direct-framework',frameworkId:f.id}),/deferred/);
 assert.equal((await db.pool.query("SELECT count(*) AS n FROM project_workflow_records")).rows[0].n,'0');
 }finally{await db.close();if(previous===undefined)delete process.env.ENABLE_DEFERRED_UPS_WORKFLOW;else process.env.ENABLE_DEFERRED_UPS_WORKFLOW=previous;}
});
