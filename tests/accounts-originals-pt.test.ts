import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {testDatabase} from './database.js';
import {projectOriginals,projectSiteEvidence,siteEvidence,siteEvidenceFile,confirmOriginalReceipt,originalsRegister} from '../server/accounts/site-evidence.js';
import {projectMaterialCostingQueue,markJobRecordedInPt,materialCostingQueue} from '../server/accounts/material-costing.js';

const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const file=(n:number,mediaType='image/jpeg')=>({id:id(n),name:`file-${n}`,mediaType});
const now=new Date('2026-11-03T07:00:00Z');

test('originals deadline starts at QC completion or final delivery, never an invented date',()=>{
 const doc=(docId:string,label:string,location:string,extra={})=>({id:docId,label,location,date:'2026-10-25',evidence:[],history:[],...extra});
 const install={name:'S',installation:true,completed:true,stage:'completed',qc:{signoff:{date:'2026-10-28',noVariableItemsUsed:false}},deliveries:[{deliveryDate:'2026-10-10',partial:false,signedDo:file(1,'application/pdf'),materialPhoto:file(2)}],
  documents:[doc('d1','Delivery DO','Received at Karachi office'),doc('s:completion-documents','Acknowledgement & variable sign-off','At site',{completionEvidenceVersion:2,noVariableItemsUsed:false})]};
 const o=projectOriginals('s',install,[],now);
 assert.equal(o.startDate,'2026-10-28');assert.equal(o.dueDate,'2026-10-31');
 assert.deepEqual(o.items.map(i=>[i.type,i.status,i.daysOverdue]),[['Signed DO','karachi-pending',3],['Customer acknowledgment','pending',3],['VSO','pending',3]]);
 assert.equal(o.items[0].statusLabel,'Karachi arrival reported — Accounts confirmation pending');
 // Explicit no-variable-items exception: no VSO demanded.
 const noVso=projectOriginals('s',{...install,documents:[install.documents[0],doc('s:completion-documents','Customer acknowledgement · no variable items used','At site',{completionEvidenceVersion:2,noVariableItemsUsed:true})]},[],now);
 assert.deepEqual(noVso.items.map(i=>i.type),['Signed DO','Customer acknowledgment']);
 // Delivery-only uses the final delivery date and needs no completion originals.
 const deliveryOnly=projectOriginals('d',{installation:false,projectType:'delivery-only',stage:'delivered',deliveries:[{deliveryDate:'2026-10-01',partial:true},{deliveryDate:'2026-11-02',partial:false}],documents:[doc('p','Partial delivery DO','At site'),doc('f','Final delivery DO','At site')]},[],now);
 assert.equal(deliveryOnly.startDate,'2026-11-02');assert.equal(deliveryOnly.dueDate,'2026-11-05');assert.equal(deliveryOnly.overdue.length,0);assert.deepEqual(deliveryOnly.items.map(i=>i.type),['Signed DO','Signed DO']);
 // Completed without a recorded completion date: flagged, no deadline invented.
 const missing=projectOriginals('m',{installation:true,completed:true,stage:'completed',documents:[doc('x','Delivery DO','At site')]},[],now);
 assert.equal(missing.missingStartDate,true);assert.equal(missing.dueDate,null);assert.equal(missing.overdue.length,0);
 assert.ok(missing.items.some(i=>i.unconfirmable&&i.type==='Customer acknowledgment'),'missing completion documents are shown');
 // Late receipt stays visible; legacy Operations handovers are retained, not reset.
 const late=projectOriginals('s',install,[{site_id:'s',item_key:'d1:Signed DO',received_on:'2026-11-02'}],now);
 assert.deepEqual([late.items[0].status,late.items[0].receivedLate,late.items[0].daysLate,late.items[0].overdue],['confirmed',true,2,false]);
 const legacy=projectOriginals('s',{...install,documents:[{...install.documents[0],location:'Submitted to Accounts'}]},[],now);
 assert.equal(legacy.items[0].status,'legacy-handover');assert.equal(legacy.items[0].overdue,false);
});

test('View Documents groups existing QC uploads by delivery and installation stage',()=>{
 const s={deliveries:[{deliveryDate:'2026-10-01',partial:true,signedDo:file(1,'application/pdf'),materialPhoto:file(2)},{deliveryDate:'2026-10-05',partial:false,signedDo:file(3,'application/pdf'),materialPhoto:file(4)}],
  qc:{civil:{date:'2026-10-07',evidence:file(5),stagePictures:{earthing:[file(6)]}},signoff:{date:'2026-10-09',acknowledgement:file(7,'application/pdf'),variableSignoff:file(8,'application/pdf'),evidence:file(9)}},documents:[]};
 const e=projectSiteEvidence('s',s);
 assert.deepEqual(e.signedDos.map((f:any)=>[f.id,f.label]),[[id(1),'Partial delivery 1'],[id(3),'Delivery 2']]);
 assert.deepEqual(e.vso.map((f:any)=>f.id),[id(8)]);assert.deepEqual(e.acknowledgments.map((f:any)=>f.id),[id(7)]);
 assert.deepEqual(e.pictureGroups.map((g:any)=>[g.stage,g.files.map((f:any)=>f.id)]),[['Partial delivery 1',[id(2)]],['Delivery 2',[id(4)]],['Civil works',[id(5),id(6)]],['Customer sign-off',[id(9)]]]);
});

async function fixture(){
 const db=await testDatabase(),ids={Admin:randomUUID(),Accounts:randomUUID(),Management:randomUUID()};
 for(const [role,uid]of Object.entries(ids))await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[uid,uid+'@example.test',role,'isolated']);
 return {db,ids};
}
async function site(db:any,owner:string,siteId:string,snapshot:any){
 await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[siteId,owner]);
 await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Test','Isolated fixture',$3,$4)",[siteId,snapshot,randomUUID(),owner]);
 for(const f of [1,2,3]){const content=Buffer.from('fixture-'+f);await db.pool.query('INSERT INTO operations_board_files(id,site_id,filename,media_type,sha256,content,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id(f),siteId,'file-'+f,f===2?'image/jpeg':'application/pdf',createHash('sha256').update(content).digest('hex'),content,owner]);}
}

test('Accounts confirms only the originals received; QC arrival alone confirms nothing',async()=>{
 const {db,ids}=await fixture();try{
  await site(db,ids.Admin,'orig',{name:'Orig site',ipo:'IPO-O',installation:true,completed:true,stage:'completed',qc:{signoff:{date:'2026-10-28',acknowledgement:file(3,'application/pdf'),noVariableItemsUsed:true}},
   deliveries:[{deliveryDate:'2026-10-10',partial:false,signedDo:file(1,'application/pdf'),materialPhoto:file(2),documentId:'orig:do'}],
   documents:[{id:'orig:do',label:'Delivery DO',location:'Received at Karachi office',date:'2026-10-30',tracking:'TCS-1',evidence:[file(1,'application/pdf')],history:[]},{id:'orig:completion-documents',label:'Customer acknowledgement · no variable items used',location:'TCS to Karachi office',date:'2026-10-29',tracking:'TCS-2',completionEvidenceVersion:2,noVariableItemsUsed:true,acknowledgement:file(3,'application/pdf'),evidence:[],history:[]}]});
  const before=await siteEvidence(db.pool,ids.Accounts,'orig');
  assert.deepEqual(before.originals.items.map((i:any)=>[i.type,i.status]),[['Signed DO','karachi-pending'],['Customer acknowledgment','pending']]);
  assert.equal((await siteEvidenceFile(db.pool,ids.Accounts,'orig',id(2))).media_type,'image/jpeg');
  await assert.rejects(siteEvidenceFile(db.pool,ids.Accounts,'orig',id(99)),/not found/);
  const input={siteVersion:1,items:['orig:do:Signed DO'],receivedOn:'2026-11-01',requestKey:randomUUID()};
  await assert.rejects(confirmOriginalReceipt(db.pool,ids.Management,'orig',input,now),/confirmation access/);
  await assert.rejects(confirmOriginalReceipt(db.pool,ids.Accounts,'orig',{...input,receivedOn:'2026-11-04',requestKey:randomUUID()},now),/future/);
  await assert.rejects(confirmOriginalReceipt(db.pool,ids.Accounts,'orig',{...input,items:['orig:completion-documents:Customer acknowledgment'],requestKey:randomUUID()},now),/not been reported at the Karachi office/);
  await confirmOriginalReceipt(db.pool,ids.Accounts,'orig',input,now);
  assert.equal((await confirmOriginalReceipt(db.pool,ids.Accounts,'orig',input,now)).receipts.length,1,'replay is idempotent');
  await assert.rejects(confirmOriginalReceipt(db.pool,ids.Accounts,'orig',{...input,requestKey:randomUUID()},now),/already confirmed/);
  const after=(await originalsRegister(db.pool,ids.Accounts,now)).sites.find((s:any)=>s.id==='orig')!.originals;
  assert.deepEqual(after.items.map((i:any)=>[i.type,i.status,i.receivedOn,i.overdue]),[['Signed DO','confirmed','2026-11-01',false],['Customer acknowledgment','pending',null,true]]);
  assert.equal(after.items[0].receivedLate,true,'receipt after the 31 Oct deadline stays visible as late');
  const snapshot=(await db.pool.query("SELECT snapshot FROM operations_board_versions WHERE site_id='orig' ORDER BY version DESC LIMIT 1")).rows[0].snapshot;
  assert.equal(snapshot.documents[1].location,'TCS to Karachi office','Operations records are not changed by Accounts receipt');
  await assert.rejects(db.pool.query('DELETE FROM accounts_original_receipts'));
 }finally{await db.close();}
});

test('Mark as Recorded in PT removes the job from Material Costing without an Inventory reconciliation',async()=>{
 assert.deepEqual(projectMaterialCostingQueue([{id:'d',jobKey:'ipo:x',siteId:'s',siteName:'S',ipo:'I',customer:'C',receivedAt:'2026-10-01'}],[],[],[],[{job_key:'ipo:x'}]),[]);
 const {db,ids}=await fixture();try{
  await site(db,ids.Admin,'pt-site',{name:'PT site',ipo:'IPO-PT',customer:'United Bank Limited',installation:true,completed:true,stage:'completed',deliveries:[{deliveryDate:'2026-10-10',partial:false,signedDo:file(1,'application/pdf'),materialPhoto:file(2)}],documents:[]});
  const queue=await materialCostingQueue(db.pool,ids.Accounts),row=queue.rows.find((r:any)=>r.siteId==='pt-site')!;
  assert.equal(row.status,'Awaiting QC usage');
  const input={jobKey:row.key,ptReference:'PT-JV-1001',entryDate:'2026-11-02',notes:'Material costs entered',requestKey:randomUUID()};
  await assert.rejects(markJobRecordedInPt(db.pool,ids.Management,input,now),/PT entry access/);
  await assert.rejects(markJobRecordedInPt(db.pool,ids.Accounts,{...input,entryDate:'2026-11-09',requestKey:randomUUID()},now),/future/);
  const saved=await markJobRecordedInPt(db.pool,ids.Accounts,input,now);
  assert.equal((await markJobRecordedInPt(db.pool,ids.Accounts,input,now)).id,saved.id);
  await assert.rejects(markJobRecordedInPt(db.pool,ids.Accounts,{...input,requestKey:randomUUID()},now),/already marked|no longer pending/);
  assert.equal((await materialCostingQueue(db.pool,ids.Accounts)).rows.some((r:any)=>r.siteId==='pt-site'),false);
  for(const table of ['accounts_job_closures','stock_on_hand_entries','accounts_invoice_entries'])assert.equal((await db.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0,'PT marking closes no job, posts no stock and creates no invoice');
 }finally{await db.close();}
});
