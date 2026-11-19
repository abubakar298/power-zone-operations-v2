import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {ProjectWorkflowRepository} from '../server/project-workflow/repository.js';

test('imported UBL snapshot IDs preserve preview, IPO issue, live FK and frozen prices', async () => {
 const db=await testDatabase();
 try {
  const actor=randomUUID();
  await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'Atif','test-only','Coordinator')",[actor,actor+'@example.test']);
  const framework=(await db.pool.query("SELECT id FROM project_framework_current WHERE customer_id=5 AND configuration_key='25-20-30:Revised'")).rows[0].id;
  const repo=new ProjectWorkflowRepository(db.pool);
  const created=await repo.create(actor,{requestKey:randomUUID(),customerId:5,siteName:'Isolated imported agreement fixture',siteCode:'IMPORT-FK',route:'direct-framework',frameworkId:framework,notes:'Synthetic migration regression'});
  const original=(await db.pool.query('SELECT data FROM project_workflow_records WHERE id=$1',[created.id])).rows[0].data.basis;
  const alias=randomUUID();
  const frozen={...original,source:{...original.source,id:alias}};
  await db.pool.query("UPDATE project_workflow_records SET data=jsonb_set(data,'{basis}',$2::jsonb) WHERE id=$1",[created.id,JSON.stringify(frozen)]);
  const evidence=await repo.attach(actor,created.id,{kind:'PO / confirmation',filename:'fixture.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4\n% synthetic\n%%EOF').toString('base64')});
  const detail=await repo.detail(actor,created.id);
  const input={reference:'IMPORT-FK-PO',date:'2026-10-27',evidenceId:evidence.id,basisType:'framework',frameworkId:alias,confirmationType:'Customer PO',actual:original.comparison,reviewed:true,notes:'Exact approved basis synthetic fixture',saleDetails:{invoiceCompany:'PZES (PVT Ltd)',salesPerson:'Atif',paymentMode:'Bank transfer'}};
  const preview=await repo.preview(actor,created.id,{kind:'framework',frameworkId:alias});
  assert.deepEqual(preview.comparison,original.comparison);
  const sale=await repo.salePreview(actor,created.id,input);
  assert.deepEqual(sale.allocation,original.order.allocation);
  await assert.rejects(repo.preview(actor,created.id,{kind:'framework',frameworkId:randomUUID()}),/Select an approved agreement/);
  const wrongCustomer=(await db.pool.query("SELECT id FROM project_framework_current WHERE customer_id=2 LIMIT 1")).rows[0].id;
  await assert.rejects(repo.salePreview(actor,created.id,{...input,frameworkId:wrongCustomer}),/Select an approved agreement/);
  await repo.action(actor,created.id,{version:detail.record.version,requestKey:randomUUID(),action:'receipt',input});
  const saved=(await db.pool.query('SELECT framework_id,stage,data FROM project_workflow_records WHERE id=$1',[created.id])).rows[0];
  assert.equal(saved.framework_id,framework);
  assert.equal(saved.stage,'issued');
  assert.deepEqual(saved.data.basis.comparison,original.comparison);
  assert.equal(saved.data.basis.fingerprint,original.fingerprint);
  assert.equal(saved.data.basis.source.id,alias);
  assert.equal((await db.pool.query('SELECT count(*) AS n FROM internal_purchase_orders')).rows[0].n,'1');
  assert.equal((await db.pool.query('SELECT count(*) AS n FROM ipo_accounts_handoffs')).rows[0].n,'1');
 } finally { await db.close(); }
});
