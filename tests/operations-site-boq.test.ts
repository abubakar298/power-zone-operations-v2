import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import {readFile} from 'node:fs/promises';

async function fixture(){
 const db=await testDatabase();
 const owner=randomUUID(),viewer=randomUUID(),head=randomUUID(),lead=randomUUID();
 for(const [id,role]of [[owner,'Admin'],[viewer,'Operations'],[head,'Operations'],[lead,'Operations']])await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'SIMULATION','test-only',$3)",[id,id+'@example.test',role]);
 for(const [id,kind,team]of [[viewer,'head',null],[head,'head',null],[lead,'lead','south']])await db.pool.query('INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,$2,$3,$4)',[id,kind,team,owner]);
 await db.pool.query("INSERT INTO operations_boq_viewers(user_id,granted_reason) VALUES($1,'SIMULATION grant')",[viewer]);
 const siteId=9101,draftId=randomUUID(),boqId=randomUUID(),revisionId=randomUUID(),poId=randomUUID(),ipoId=randomUUID(),opId=randomUUID();
 await db.pool.query("INSERT INTO sites(id,customer_id,name,code,location,status) VALUES($1,1,'SIMULATION Site','SYNB1','Lahore','Active')",[siteId]);
 await db.pool.query("INSERT INTO survey_drafts(id,owner_id,inputs) VALUES($1,$2,'{}')",[draftId,owner]);
 await db.pool.query('INSERT INTO boqs(id,draft_id,site_id,customer_id,sequence,created_by) VALUES($1,$2,$3,1,1,$4)',[boqId,draftId,siteId,owner]);
 await db.pool.query('INSERT INTO boq_revisions(id,boq_id,revision,number,snapshot,created_by) VALUES($1,$2,0,$3,$4,$5)',[revisionId,boqId,'SIM-PBQ-1',{survey:{customerId:1,siteCode:'SYNB1'},lines:[],total:'100.00'},owner]);
 await db.pool.query("INSERT INTO customer_purchase_orders(id,customer_id,po_number,input,created_by) VALUES($1,1,'SIM-PO-1','{}',$2)",[poId,owner]);
 await db.pool.query("INSERT INTO internal_purchase_orders(id,customer_po_id,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,'SIM-IPO-1','{}',$3,$4,$5)",[ipoId,poId,'b'.repeat(64),randomUUID(),owner]);
 // The issued copy may carry other fields; only the whitelisted ones may be returned.
 const items=[{key:'Solar PV Modules',description:'Solar PV Modules',brand:'Brand A',specification:'585 W',qty:'20',unit:'No.',boqQty:'11.7',boqUnit:'kW',rate:'999',cost:'888'},{key:'DC cable',description:'DC cable 6mm',brand:null,specification:null,qty:'150',unit:'m'}];
 await db.pool.query('INSERT INTO operations_boq_issuances(id,ipo_id,boq_revision_id,number,snapshot,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[opId,ipoId,revisionId,'SIM-FBOQ-1',{boqNumber:'SIM-PBQ-1',siteName:'SIMULATION Site',siteCode:'SYNB1',customerPo:'SIM-PO-1',phone:'0300',items},randomUUID(),owner]);
 const board=async(id:string,snapshot:Record<string,unknown>)=>{await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[id,owner]);await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Source imported','SIMULATION',$3,$4)",[id,{id,name:'SIMULATION Site',ipo:'SIM-IPO-1',stage:'received',documents:[],...snapshot},randomUUID(),owner]);};
 await board('live-ipo:'+ipoId,{operationsTeam:'central',origin:{kind:'live-ipo-handoff',ipoId,operationsIssuanceId:opId}});
 await board('registered-old',{operationsTeam:'central'});
 return {db,repo:new OperationsBoardRepository(db.pool),owner,viewer,head,lead,linked:'live-ipo:'+ipoId};
}

test('BOQ details: only granted accounts see the issued items, quantities only, read-only',async()=>{
 const {db,repo,owner,viewer,head,lead,linked}=await fixture();try{
  assert.equal(await repo.boqViewer(viewer),true);
  for(const actor of [owner,head,lead])assert.equal(await repo.boqViewer(actor),false);
  const details=await repo.siteBoq(viewer,linked);
  assert.deepEqual(details,{linked:true,issuanceNumber:'SIM-FBOQ-1',issuedAt:(details as any).issuedAt,ipoNumber:'SIM-IPO-1',boqNumber:'SIM-PBQ-1',siteName:'SIMULATION Site',siteCode:'SYNB1',items:[
   {description:'Solar PV Modules',brand:'Brand A',specification:'585 W',qty:'20',unit:'No.'},
   {description:'DC cable 6mm',brand:null,specification:null,qty:'150',unit:'m'}]});
  assert.doesNotMatch(JSON.stringify(details),/999|888|rate|cost|0300/,'no prices, costs or contact details');
  assert.deepEqual(await repo.siteBoq(viewer,'registered-old'),{linked:false});
  // Not granted: refused, even for Admin and other heads. Site scope still applies.
  for(const actor of [owner,head,lead])await assert.rejects(repo.siteBoq(actor,linked),/not available/);
  await assert.rejects(repo.siteBoq(viewer,'missing-site'));
  // Reading changes nothing.
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_board_versions')).rows[0].n,2);
 }finally{await db.close();}
});

test('BOQ details stay inside the Operations board routes and the grant names one account',async()=>{
 const http=await readFile('server/operations-board/http.ts','utf8'),migration=await readFile('migrations/306_operations_boq_viewers.sql','utf8');
 assert.match(http,/r\.get\('\/sites\/:id\/boq'/);
 assert.doesNotMatch(http,/r\.post\('\/sites\/:id\/boq/,'view only: no write route');
 assert.equal((migration.match(/INSERT INTO operations_boq_viewers/g)??[]).length,1);
});
