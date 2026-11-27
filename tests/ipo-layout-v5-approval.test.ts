import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {createDashboardSamples} from '../server/coordinator/samples.js';
import {OrdersRepository} from '../server/orders/repository.js';
import {orderSchema} from '../server/orders/schema.js';
import {fingerprint} from '../server/boq/repository.js';

test('new IPOs use layout v5 (salesperson row); a submission saved before the release with layout v4 still approves',async()=>{
 const db=await testDatabase();try{
  const owner=randomUUID(),manager=randomUUID();
  for(const [id,role] of [[owner,'Coordinator'],[manager,'Management']])await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated-test',$4)",[id,id+'@example.test',role,role]);
  const samples=await createDashboardSamples(db.pool,owner,manager);
  const source=samples.find((r:any)=>r.quotationId&&r.stage===7)!;
  const input=orderSchema.parse({quotationId:source.quotationId,evidenceType:'Verbal sale confirmation',evidenceNotes:'Isolated test only',orderDate:'2026-11-20',invoiceCompany:'Power Zone Engineering & Services',salesPerson:'Waqas ul Haq',customerAccepted:true,remarks:'Isolated test only'});
  const orders=new OrdersRepository(db.pool);
  const preview=await orders.preview(owner,input);
  assert.equal(preview.snapshot.documentLayoutVersion,5);assert.equal(preview.snapshot.input.salesPerson,'Waqas ul Haq');
  // The same submission as it was saved before this release: identical except the layout version.
  const before={...preview.snapshot,documentLayoutVersion:4},id=randomUUID();
  await db.pool.query('INSERT INTO ipo_submissions(id,input,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6)',[id,input,before,fingerprint(before),randomUUID(),owner]);
  const issued=await orders.approve(manager,id,randomUUID());
  assert.ok(issued.id,'approved without "Review the current IPO preview"');
  assert.equal((await db.pool.query('SELECT snapshot->>\'documentLayoutVersion\' AS v FROM internal_purchase_orders WHERE id=$1',[issued.id])).rows[0].v,'5');
 }finally{await db.close();}
});
