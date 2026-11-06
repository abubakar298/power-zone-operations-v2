import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {ProjectWorkflowRepository} from '../server/project-workflow/repository.js';

test('UBL technical submission accepts optional blank remarks, preserves originals and creates one audited handoff per site',async()=>{
 const db=await testDatabase();try{
 const coordinator=randomUUID(),design=randomUUID();
 for(const[id,role]of [[coordinator,'Coordinator'],[design,'Design']])await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated',$4)",[id,id+'@example.test',role,role]);
 const framework=(await db.pool.query("SELECT id FROM project_framework_current WHERE customer_id=5 AND configuration_key='20-20-30:Revised'")).rows[0].id;
 const repo=new ProjectWorkflowRepository(db.pool);
 const frameworkBefore=JSON.stringify((await db.pool.query('SELECT payload FROM project_framework_versions WHERE id=$1',[framework])).rows[0].payload);
 for(const [i,notes]of ['', '   ', 'Cable differences retained for review.'].entries()){
  const r=await repo.create(coordinator,{requestKey:randomUUID(),customerId:5,siteName:'Disposable review '+i,siteCode:'REVIEW-'+i,route:'survey-framework',frameworkId:framework,notes:'Isolated technical review fixture'});
  await db.pool.query("UPDATE project_workflow_records SET stage='report_received',technical_owner_id=$2 WHERE id=$1",[r.id,design]);
  const before=await repo.detail(design,r.id);
  const command={version:before.record.version,requestKey:randomUUID(),action:'submit-technical-review',input:{frameworkId:framework,profileKey:'standard-installation',profileVersion:1,itemSelections:{},markups:{},notes}};
  await repo.action(design,r.id,command);
  await repo.action(design,r.id,command);
  const after=await repo.detail(design,r.id);
  assert.equal(after.record.stage,'design_handed_off');
  assert.ok(after.record.data.designHandoffAt);assert.ok(after.record.data.reviewDocumentId);
  assert.equal((await db.pool.query('SELECT data FROM project_workflow_records WHERE id=$1',[r.id])).rows[0].data.coordinationSurveyReviewPending,true);
  assert.equal(after.review?.notes,notes.trim());
  const docs=(await db.pool.query("SELECT kind,snapshot FROM project_workflow_documents WHERE record_id=$1",[r.id])).rows;
  assert.equal(docs.filter(d=>d.kind==='Technical review').length,1);
  assert.equal(docs.filter(d=>d.kind==='Recommendation').length,1);
  assert.equal(docs.find(d=>d.kind==='Technical review').snapshot.notes,notes.trim());
  const events=(await db.pool.query("SELECT snapshot FROM project_workflow_events WHERE record_id=$1 AND action='submit-technical-review'",[r.id])).rows;
  assert.equal(events.length,1);assert.equal(events[0].snapshot.reason,notes.trim()||'Technical review submitted to Coordination.');
 }
 assert.equal(JSON.stringify((await db.pool.query('SELECT payload FROM project_framework_versions WHERE id=$1',[framework])).rows[0].payload),frameworkBefore);
 assert.equal((await db.pool.query('SELECT count(*) FROM internal_purchase_orders')).rows[0].count,'0');
 }finally{await db.close();}
});
