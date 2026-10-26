import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {ProjectWorkflowRepository} from '../server/project-workflow/repository.js';
test('request attachment removal is scoped to the owner and draft request, preserves other files and audits removal',async()=>{
 const db=await testDatabase();
 try {
  const actor=randomUUID(),other=randomUUID();
  for(const id of [actor,other]) await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'Atif','test-only','Coordinator')",[id,`${id}@example.test`]);
  const repo=new ProjectWorkflowRepository(db.pool);
  const create=()=>repo.create(actor,{requestKey:randomUUID(),customerId:5,siteName:'Evidence test',siteCode:randomUUID().slice(0,8),route:'survey-framework',notes:'Disposable evidence test'});
  const a=await create(),b=await create();
  const attach=(id:string,name:string)=>repo.attach(actor,id,{kind:'Request evidence',filename:name,mime:'application/pdf',base64:Buffer.from('%PDF-1.4 '+name).toString('base64')});
  const first=await attach(a.id,'first.pdf'),keep=await attach(a.id,'keep.pdf'),foreign=await attach(b.id,'other.pdf');
  await assert.rejects(repo.removeRequestFile(other,a.id,first.id));
  await assert.rejects(repo.removeRequestFile(actor,a.id,foreign.id));
  await repo.removeRequestFile(actor,a.id,first.id);
  assert.equal((await repo.file(actor,a.id,keep.id)).filename,'keep.pdf');
  await assert.rejects(repo.file(actor,a.id,first.id));
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM audit_log WHERE action LIKE $1",[`project.workflow.remove-request-file:${a.id}:%`])).rows[0].n,1);
  await db.pool.query("UPDATE project_workflow_records SET stage='survey_requested' WHERE id=$1",[a.id]);
  await assert.rejects(repo.removeRequestFile(actor,a.id,keep.id));
  assert.equal((await repo.file(actor,a.id,keep.id)).filename,'keep.pdf');
 } finally {await db.close();}
});
