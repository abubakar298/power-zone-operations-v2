import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {createDashboardSamples} from '../server/coordinator/samples.js';
import {ProjectWorkflowRepository} from '../server/project-workflow/repository.js';

// Department page → Dispatch Approved Quotation. The person's name typed in "Customer / salesperson recipient"
// (for example "Mr. Sohail") must not break the dispatch: the dispatch table only allows Customer or Salesperson.
for(const [via,kind] of [['Customer','Customer'],['Sales','Salesperson']] as const)
 test(`dispatch to ${via} with a person's name as recipient is saved`,async()=>{
  const db=await testDatabase();try{
   const owner=randomUUID(),manager=randomUUID();
   for(const [id,role] of [[owner,'Coordinator'],[manager,'Management']])await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated-test',$4)",[id,id+'@example.test',role,role]);
   const samples=await createDashboardSamples(db.pool,owner,manager);
   const source=samples.find((r:any)=>r.quotationId&&r.stage===6)!;
   const q=(await db.pool.query('SELECT q.snapshot,b.customer_id FROM quotation_versions q JOIN boq_revisions br ON br.id=q.boq_revision_id JOIN boqs b ON b.id=br.boq_id WHERE q.id=$1',[source.quotationId])).rows[0];
   const id=randomUUID(),repo=new ProjectWorkflowRepository(db.pool);
   await db.pool.query("INSERT INTO project_workflow_records(id,customer_id,site_name,site_code,route,stage,coordinator_id,data,request_key,created_by) VALUES($1,$2,'Dispatch recipient fixture',$3,'quick-quote','approved_dispatch',$4,$5,$6,$4)",[id,q.customer_id,q.snapshot.siteCode,owner,{quotationId:source.quotationId,latestQuotationId:source.quotationId},randomUUID()]);
   const evidence=await repo.attach(owner,id,{kind:'Recommendation sending evidence',filename:'sent.png',mime:'image/png',base64:Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).toString('base64')});
   const version=(await db.pool.query('SELECT version FROM project_workflow_records WHERE id=$1',[id])).rows[0].version;
   await repo.action(owner,id,{version,requestKey:randomUUID(),action:'dispatch',input:{via,recipient:'Mr. Sohail',evidenceId:evidence.id,notes:'Sent'}});
   const sent=(await db.pool.query('SELECT recipient,notes FROM quotation_dispatch_records WHERE quotation_id=$1',[source.quotationId])).rows[0];
   assert.equal(sent.recipient,kind,'the dispatch table keeps Customer or Salesperson');
   assert.match(sent.notes,/Mr\. Sohail/,'the person\'s name is kept with the dispatch');
   const record=(await db.pool.query('SELECT stage,data FROM project_workflow_records WHERE id=$1',[id])).rows[0];
   assert.equal(record.stage,'customer_tracking');
   assert.equal(record.data.recipient,'Mr. Sohail');
   assert.equal(record.data.dispatchVia,via);
  }finally{await db.close();}
 });
