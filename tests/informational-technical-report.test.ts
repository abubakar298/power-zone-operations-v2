import{test}from'node:test';
import assert from'node:assert/strict';
import{randomUUID}from'node:crypto';
import{testDatabase}from'./database.js';
import{ProjectWorkflowRepository}from'../server/project-workflow/repository.js';
import{NotificationsRepository}from'../server/notifications/repository.js';
test('non-UBL report reaches Management once without changing workflow/pricing, leaks no costing to sender and queues no email',async()=>{
 const db=await testDatabase();try{
  const actor=randomUUID(),manager=randomUUID(),record=randomUUID(),review=randomUUID();
  for(const [id,role]of[[actor,'Coordinator'],[manager,'Admin']])await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,'unused')",[id,id+'@test.invalid',role==='Admin'?'Abu Bakar':'Atif fixture',role]);
  const source={boq:{lines:[{key:'CH-PCS-TEST',description:'Inverter',phase:'BESS',rate:'100',total:'100',qty:'1',unit:'No.'}],engineering:{solutionId:'test'},rules:[]},notes:'Saved reviewed scope'};
  await db.pool.query("INSERT INTO project_workflow_records(id,customer_id,site_name,site_code,route,stage,coordinator_id,data,request_key,created_by) VALUES($1,3,'Disposable technical report','INFO-TEST','survey-quote','design_handed_off',$2,$3,$4,$2)",[record,actor,{reviewDocumentId:review,designHandoffAt:new Date().toISOString()},randomUUID()]);
  await db.pool.query("INSERT INTO project_workflow_documents(id,record_id,kind,version,number,snapshot,created_by) VALUES($1,$2,'Technical review',1,'TS-TEST',$3,$4)",[review,record,source,actor]);
  const before=(await db.pool.query('SELECT * FROM project_workflow_records WHERE id=$1',[record])).rows[0],repo=new ProjectWorkflowRepository(db.pool);
  const first=await repo.sendInformationalTechnicalReport(actor,record,{version:1}),second=await repo.sendInformationalTechnicalReport(actor,record,{version:1});assert.equal(first.document_id,second.document_id);assert.equal(second.repeated,true);
  assert.deepEqual((await db.pool.query('SELECT * FROM project_workflow_records WHERE id=$1',[record])).rows[0],before);
  assert.deepEqual((await db.pool.query('SELECT snapshot FROM project_workflow_documents WHERE id=$1',[review])).rows[0].snapshot,source);
  const stored=(await db.pool.query('SELECT snapshot FROM project_workflow_documents WHERE id=$1',[first.document_id])).rows[0].snapshot;assert.equal(stored.costing.total,'100.00');assert.equal(stored.informational,true);
  const restricted=await repo.documentData(actor,record,first.document_id);assert.equal(restricted.snapshot.costing.lines[0].cost,null);
  await new NotificationsRepository(db.pool).sync();
  const notifications=(await db.pool.query("SELECT n.* FROM notifications n WHERE source_key LIKE 'technical-information:%'")).rows;assert.equal(notifications.length,1);assert.equal(notifications[0].user_id,manager);assert.equal(notifications[0].actionable,false);assert.ok(notifications[0].target.url.includes(first.document_id));
  assert.equal((await db.pool.query('SELECT count(*) AS n FROM notification_email_queue WHERE id=$1',[notifications[0].id])).rows[0].n,'0');
  assert.equal((await db.pool.query('SELECT count(*) AS n FROM commercial_pricing_versions')).rows[0].n,'0');
  await assert.rejects(repo.sendInformationalTechnicalReport(actor,record,{version:9}),/changed/);
 }finally{await db.close();}
});
