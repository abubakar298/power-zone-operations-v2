import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {UblWorkflowRepository} from '../server/ubl/workflow-repository.js';
import {removeLahoreSurveyBatch,removalKey,removalSites} from '../server/maintenance/remove-lahore-survey-batch.js';

test('Director cleanup removes only 20 exact surveys, rolls back unknown dependencies, preserves Solar and other sites, and never repeats',async()=>{
 const db=await testDatabase();
 try{
  const actor=randomUUID();
  await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,'director-cleanup@example.test','Abu Bakar Siddique','fixture','Management')",[actor]);
  for(const [id,code] of removalSites)await db.pool.query("INSERT INTO sites(id,customer_id,name,code,location,status) VALUES($1,5,$2,$3,'','Active')",[id,'Target '+code,String(Number(code))]);
  const repo=new UblWorkflowRepository(db.pool);
  await repo.import(actor,(await repo.sources(actor))[0].sha256);
  // The production bridge was created by migration 059 after the real import.
  await db.pool.query(`INSERT INTO project_workflow_records(id,customer_id,site_id,site_name,site_code,route,stage,coordinator_id,legacy_type,legacy_id,request_key,created_by)
   SELECT gen_random_uuid(),customer_id,site_id,site_name,COALESCE(branch_code,'UNKNOWN-'||source_row),'survey-framework','customer_tracking',$1,'ubl',id,gen_random_uuid(),$1 FROM ubl_workflow_requests`,[actor]);
  assert.equal(await removeLahoreSurveyBatch(db.pool),undefined);
  const before=(await db.pool.query('SELECT * FROM ubl_site_orders ORDER BY site_id')).rows;
  const keep=(await db.pool.query('SELECT * FROM sites WHERE NOT(id=ANY($1::int[])) ORDER BY id',[removalSites.map(([id])=>id)])).rows;
  const remaining=(await db.pool.query('SELECT * FROM ubl_workflow_requests WHERE NOT(site_id=ANY($1::int[])) OR site_id IS NULL ORDER BY id',[removalSites.map(([id])=>id)])).rows;
  await db.pool.query('CREATE TABLE unexpected_site_dependency(site_id int REFERENCES sites(id))');
  await db.pool.query('INSERT INTO unexpected_site_dependency VALUES(90)');
  await assert.rejects(removeLahoreSurveyBatch(db.pool,removalKey),/foreign key/);
  assert.equal((await db.pool.query('SELECT count(*) FROM ubl_workflow_requests')).rows[0].count,'36');
  assert.equal((await db.pool.query('SELECT count(*) FROM ubl_workflow_documents')).rows[0].count,'58');
  assert.equal((await db.pool.query("SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='D'")).rows[0].count,'0');
  await db.pool.query('DELETE FROM unexpected_site_dependency');
  const result=await removeLahoreSurveyBatch(db.pool,removalKey);
  assert.ok(result && "sites" in result);
  assert.equal(result.sites,20);
  assert.equal(result.ubl_workflow_documents,40);
  assert.equal(result.ubl_workflow_events,20);
  assert.deepEqual((await db.pool.query('SELECT * FROM ubl_site_orders ORDER BY site_id')).rows,before);
  assert.deepEqual((await db.pool.query('SELECT * FROM sites ORDER BY id')).rows,keep);
  assert.deepEqual((await db.pool.query('SELECT * FROM ubl_workflow_requests ORDER BY id')).rows,remaining);
  assert.equal(remaining.length,16);
  assert.equal((await db.pool.query("SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='D'")).rows[0].count,'0');
  await db.pool.query("INSERT INTO sites(id,customer_id,name,code,location,status) VALUES(90,5,'Re-entered Abid Market','0859','','Active')");
  assert.deepEqual(await removeLahoreSurveyBatch(db.pool,removalKey),{alreadyCompleted:true});
  assert.equal((await db.pool.query('SELECT code FROM sites WHERE id=90')).rows[0].code,'0859');
 }finally{await db.close();}
});
