import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import type {BoardSite} from '../server/operations-board/schema.js';
import {confirmOriginalReceipt,originalsRegister} from '../server/accounts/site-evidence.js';

test('originals confirmed by Accounts show for Operations as handed over to Accounts, one document batch at a time',async()=>{
 const db=await testDatabase();try{
  const users:Record<string,string>={};
  for(const [name,role] of [['owner','Admin'],['accounts','Accounts'],['head','Operations'],['lead','Operations'],['southlead','Operations']]){users[name]=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[users[name],name+'@example.test',name,role,'isolated']);}
  for(const [name,kind,team] of [['head','head',null],['lead','lead','central'],['southlead','lead','south']] as const)await db.pool.query('INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,$2,$3,$4)',[users[name],kind,team,users.owner]);
  const repo=new OperationsBoardRepository(db.pool);
  const doc=(id:string,label:string):NonNullable<BoardSite['documents']>[number]=>({id,label,location:'Received at Karachi office',date:'2026-11-01',createdDate:'2026-10-30',evidence:[],history:[]});
  await repo.importSource(users.owner,{sourceSha256:'a'.repeat(64),rows:[
   {id:'s1',ipo:'IPO-1',name:'Site one',stage:'completed',completed:true,installation:true,projectType:'solar',operationsTeam:'central',documents:[doc('s1:delivery','Delivery DO'),doc('s1:completion-documents','Acknowledgement & variable sign-off')]},
  ]});
  const listed=async(user:string)=>(await repo.accountsReceipts(user)).documents.map(d=>d.documentId).sort();
  assert.deepEqual(await listed(users.head),[],'nothing confirmed by Accounts yet');
  const items=(await originalsRegister(db.pool,users.accounts)).sites.find(s=>s.id==='s1')!.originals.items;
  const version=(await db.pool.query("SELECT max(version)::int v FROM operations_board_versions WHERE site_id='s1'")).rows[0].v;
  const confirm=(keys:string[])=>confirmOriginalReceipt(db.pool,users.accounts,'s1',{siteVersion:version,items:keys,receivedOn:'2026-11-03',requestKey:randomUUID()},new Date('2026-11-05T10:00:00Z'));
  await confirm(items.filter((i:any)=>i.documentId==='s1:delivery').map((i:any)=>i.key));
  assert.deepEqual(await listed(users.head),['s1:delivery']);
  const completion=items.filter((i:any)=>i.documentId==='s1:completion-documents').map((i:any)=>i.key);
  assert.ok(completion.length>=1);
  if(completion.length>1){await confirm(completion.slice(0,1));assert.deepEqual(await listed(users.head),['s1:delivery'],'a partly confirmed batch is not counted yet');await confirm(completion.slice(1));}
  else await confirm(completion);
  assert.deepEqual(await listed(users.head),['s1:completion-documents','s1:delivery']);
  assert.deepEqual(await listed(users.lead),['s1:completion-documents','s1:delivery'],'the central lead sees their site');
  assert.deepEqual(await listed(users.southlead),[],'another team sees nothing');
  assert.equal((await repo.accountsReceipts(users.head)).documents.find(d=>d.documentId==='s1:delivery')!.receivedOn,'2026-11-03');
  await assert.rejects(repo.accountsReceipts(users.accounts),/document tracking only/);
  const latest=(await db.pool.query("SELECT snapshot FROM operations_board_versions WHERE site_id='s1' ORDER BY version DESC LIMIT 1")).rows[0].snapshot;
  assert.ok(latest.documents.every((d:any)=>d.location==='Received at Karachi office'),'the site record is not changed');
 }finally{await db.close();}
});
