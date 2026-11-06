import {readWorkflowSite} from './operations-snapshot.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import {batchSchema} from '../server/operations-board/schema.js';

test('a batch made by mistake can be deleted: sites are released, the vehicle is free again, history is kept',async()=>{
 const db=await testDatabase();try{
  const owner=randomUUID(),lead=randomUUID(),qc=randomUUID();
  for(const [id,role] of [[owner,'Admin'],[lead,'Operations'],[qc,'Operations']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role,role,'isolated']);
  for(const [id,kind] of [[lead,'lead'],[qc,'qc']])await db.pool.query("INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,$2,'central',$3)",[id,kind,owner]);
  const repo=new OperationsBoardRepository(db.pool);
  await repo.importSource(owner,{sourceSha256:'c'.repeat(64),rows:['one','two'].map(id=>({id,ipo:id,name:id,stage:'received',projectType:'ups',installation:true,operationsTeam:'central'}))});
  const plan=async()=>batchSchema.parse({version:0,requestKey:randomUUID(),team:'central',kind:'both',deliveryDate:'2026-11-18',vehicle:'PZ Bolan BYQ-241',driver:'Arslan',labourTeam:'pz-team',stops:await Promise.all(['one','two'].map(async(siteId,n)=>({siteId,siteVersion:(await readWorkflowSite(repo,owner,siteId)).version,order:n+1,plannedDate:'2026-11-25',pocName:n?'':'Khalid',pocPhone:n?'':'03086330163'})))});
  const batch=await repo.saveBatch(lead,await plan());
  const command={id:batch.id,version:batch.version,requestKey:randomUUID(),reason:'Created by mistake'};
  await assert.rejects(repo.deleteBatch(qc,command),/Operations lead/);
  await assert.rejects(repo.deleteBatch(lead,{...command,version:9}),/updated/);
  const deleted=await repo.deleteBatch(lead,command);assert.deepEqual([deleted.number,deleted.version,deleted.deleted],[batch.number,2,true]);
  assert.deepEqual(await repo.deleteBatch(lead,command),deleted,'a retry returns the same result');
  await assert.rejects(repo.deleteBatch(lead,{...command,version:2,requestKey:randomUUID()}),/already deleted/);
  assert.equal((await repo.batches(lead)).batches.some(b=>b.id===batch.id),false,'gone from Saved batch plans');
  for(const id of ['one','two']){const site=await readWorkflowSite(repo,owner,id);assert.equal(site.planningBatches.some((b:any)=>b.id===batch.id),false);assert.equal(site.installationPlanDate,undefined);assert.equal(site.stage,'received');assert.ok(site.history.some((h:any)=>/batch deleted\. Reason: Created by mistake/.test(h.description)));}
  const versions=(await db.pool.query('SELECT version,reason,snapshot FROM operations_board_batch_versions WHERE batch_id=$1 ORDER BY version',[batch.id])).rows;
  assert.equal(versions.length,2,'the original plan is kept');assert.equal(versions[1].snapshot.deleted,true);assert.equal(versions[1].snapshot.deletedStops.length,2);assert.equal(versions[1].reason,'Created by mistake');
  assert.equal((await repo.saveBatch(lead,await plan())).stops.length,2,'the vehicle and labour team are free for a new batch the same day');
 }finally{await db.close();}
});

test('a batch with delivered work cannot be deleted',async()=>{
 const db=await testDatabase();try{
  const owner=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[owner,owner+'@example.test','Admin','Admin','isolated']);
  const repo=new OperationsBoardRepository(db.pool);
  await repo.importSource(owner,{sourceSha256:'d'.repeat(64),rows:['a','b'].map(id=>({id,ipo:id,name:'Site '+id,stage:'received',projectType:'ups',installation:true,operationsTeam:'central'}))});
  const batch=await repo.saveBatch(owner,batchSchema.parse({version:0,requestKey:randomUUID(),team:'central',kind:'delivery',deliveryDate:'2026-11-18',vehicle:'V-1',driver:'D',stops:await Promise.all(['a','b'].map(async(siteId,n)=>({siteId,siteVersion:(await readWorkflowSite(repo,owner,siteId)).version,order:n+1,plannedDate:'2026-11-25'})))}));
  // Site a's delivery is recorded after the batch was planned.
  const latest=(await db.pool.query("SELECT version,snapshot FROM operations_board_versions WHERE site_id='a' ORDER BY version DESC LIMIT 1")).rows[0];
  await db.pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,request_sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',['a',latest.version+1,{...latest.snapshot,stage:'delivered',deliveryDate:'2026-11-18'},'Delivery recorded','Fixture delivery',randomUUID(),'f'.repeat(64),owner]);
  await assert.rejects(repo.deleteBatch(owner,{id:batch.id,version:batch.version,requestKey:randomUUID(),reason:'Created by mistake'}),/Site a already has delivered or completed work/);
  assert.equal((await repo.batches(owner)).batches.some(b=>b.id===batch.id),true,'nothing changed');
 }finally{await db.close();}
});
