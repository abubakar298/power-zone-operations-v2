import {readWorkflowSite} from './operations-snapshot.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import {batchSchema} from '../server/operations-board/schema.js';
import {installationDocumentsAtKarachi} from '../server/operations-board/batch-documents.js';

test('only installation documents received at Karachi (or later at Accounts) finish a site in its batch',()=>{
 const doc=(id:string,location:string)=>({documents:[{id,location}]});
 assert.equal(installationDocumentsAtKarachi('s',doc('s:completion-documents','At site')),false);
 assert.equal(installationDocumentsAtKarachi('s',doc('s:completion-documents','TCS to Karachi office')),false,'still on the way');
 assert.equal(installationDocumentsAtKarachi('s',doc('s:completion-documents','Received at Karachi office')),true);
 assert.equal(installationDocumentsAtKarachi('s',doc('s:historical-handover-documents','Received at Karachi office')),true);
 assert.equal(installationDocumentsAtKarachi('s',doc('s:completion-documents','Submitted to Accounts')),true);
 assert.equal(installationDocumentsAtKarachi('s',doc('s:delivery:1','Received at Karachi office')),false,'delivery documents do not count');
 assert.equal(installationDocumentsAtKarachi('s',doc('s:historical-delivery-documents','Received at Karachi office')),false);
 assert.equal(installationDocumentsAtKarachi('s',doc('other:completion-documents','Received at Karachi office')),false,'another site');
 assert.equal(installationDocumentsAtKarachi('s',undefined),false);
});

test('saved batches flag each site whose installation documents reached Karachi; the batch itself is unchanged',async()=>{
 const db=await testDatabase();try{
  const owner=randomUUID(),lead=randomUUID();
  for(const [id,role] of [[owner,'Admin'],[lead,'Operations']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role,role,'isolated']);
  await db.pool.query("INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,'lead','central',$2)",[lead,owner]);
  const repo=new OperationsBoardRepository(db.pool);
  await repo.importSource(owner,{sourceSha256:'e'.repeat(64),rows:['one','two'].map(id=>({id,ipo:id,name:id,stage:'received',projectType:'solar',installation:true,operationsTeam:'central'}))});
  const batch=await repo.saveBatch(lead,batchSchema.parse({version:0,requestKey:randomUUID(),team:'central',kind:'both',deliveryDate:'2026-11-18',vehicle:'V-1',driver:'D',labourTeam:'pz-team',stops:await Promise.all(['one','two'].map(async(siteId,n)=>({siteId,siteVersion:(await readWorkflowSite(repo,owner,siteId)).version,order:n+1,plannedDate:'2026-11-25'})))}));
  const flags=async()=>Object.fromEntries((await repo.batches(lead)).batches.find(b=>b.id===batch.id)!.stops.map((s:any)=>[s.siteId,s.installationDocumentsAtKarachi]));
  assert.deepEqual(await flags(),{one:false,two:false});
  const addDocument=async(location:string)=>{const latest=(await db.pool.query("SELECT version,snapshot FROM operations_board_versions WHERE site_id='one' ORDER BY version DESC LIMIT 1")).rows[0];
   await db.pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,request_sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',['one',latest.version+1,{...latest.snapshot,stage:'completed',completed:true,documents:[{id:'one:completion-documents',label:'Acknowledgement & variable sign-off',location,date:'2026-11-20',evidence:[],history:[]}]},'Fixture','Fixture',randomUUID(),'f'.repeat(64),owner]);};
  await addDocument('TCS to Karachi office');
  assert.deepEqual(await flags(),{one:false,two:false},'sent but not yet received');
  await addDocument('Received at Karachi office');
  assert.deepEqual(await flags(),{one:true,two:false});
  const saved=(await repo.batches(lead)).batches.find(b=>b.id===batch.id)!;
  assert.equal(saved.stops.length,2,'the batch still holds both sites, so editing keeps them');assert.equal(saved.version,batch.version);assert.equal(saved.canEdit,true);
 }finally{await db.close();}
});
