import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import type {BoardSite} from '../server/operations-board/schema.js';
import {confirmOriginalReceipt,originalsRegister} from '../server/accounts/site-evidence.js';

test('Accounts can confirm originals at the Lahore head office as well as Karachi; other locations stay unconfirmable',async()=>{
 const db=await testDatabase();try{
  const owner=randomUUID(),accounts=randomUUID(),head=randomUUID();
  for(const [id,role] of [[owner,'Admin'],[accounts,'Accounts'],[head,'Operations']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role,role,'isolated']);
  await db.pool.query("INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,'head',NULL,$2)",[head,owner]);
  const doc=(id:string,label:string,location:NonNullable<BoardSite['documents']>[number]['location']):NonNullable<BoardSite['documents']>[number]=>({id,label,location,date:'2026-11-01',createdDate:'2026-10-30',evidence:[],history:[]});
  await new OperationsBoardRepository(db.pool).importSource(owner,{sourceSha256:'b'.repeat(64),rows:[
   {id:'lhr',ipo:'IPO-L',name:'Lahore site',stage:'completed',completed:true,installation:true,projectType:'solar',operationsTeam:'central',documents:[doc('lhr:delivery','Delivery DO','Received at Lahore head office'),doc('lhr:completion-documents','Acknowledgement & variable sign-off','At site')]},
  ]});
  const items=async()=>(await originalsRegister(db.pool,accounts)).sites.find(s=>s.id==='lhr')!.originals;
  const before=await items();
  const delivery=before.items.find((i:any)=>i.documentId==='lhr:delivery')!,atSite=before.items.find((i:any)=>i.documentId==='lhr:completion-documents')!;
  assert.equal(delivery.status,'lahore-pending');assert.equal(delivery.statusLabel,'At Lahore head office — Accounts confirmation pending');
  assert.equal(atSite.status,'pending');
  assert.ok(before.missing.some((i:any)=>i.key===delivery.key),'still outstanding until Accounts confirms');
  const version=(await db.pool.query("SELECT max(version)::int v FROM operations_board_versions WHERE site_id='lhr'")).rows[0].v;
  const confirm=(keys:string[],receivedOn='2026-11-03')=>confirmOriginalReceipt(db.pool,accounts,'lhr',{siteVersion:version,items:keys,receivedOn,requestKey:randomUUID()},new Date('2026-11-05T10:00:00Z'));
  await assert.rejects(confirm([atSite.key]),/Karachi office or the Lahore head office/);
  await assert.rejects(confirm([delivery.key],'2026-10-31'),/before the Lahore head office arrival/);
  await confirm([delivery.key]);
  const after=await items();
  assert.equal(after.items.find((i:any)=>i.key===delivery.key)!.status,'confirmed');
  assert.ok(!after.missing.some((i:any)=>i.key===delivery.key));
  // Operations sees the confirmed Lahore batch as handed over to Accounts.
  assert.deepEqual((await new OperationsBoardRepository(db.pool).accountsReceipts(head)).documents.map(d=>d.documentId),['lhr:delivery']);
 }finally{await db.close();}
});
