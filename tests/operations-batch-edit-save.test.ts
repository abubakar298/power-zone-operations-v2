import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {batchSchema} from '../server/operations-board/schema.js';
import {batchStopsForSave} from '../web/pages/operations-board/batch-stops.js';
import {testDatabase} from './database.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import {canRecordSiteDelivery} from '../shared/operations-delivery-ready.js';
import {readWorkflowSite} from './operations-snapshot.js';

// A saved batch as Batch planning loads it for "Edit batch": the server adds the display-only
// installationDocumentsAtKarachi fact to every site (see OperationsBoardRepository.batches).
const loaded=[
 {siteId:'wan-bachran',siteVersion:3,kind:'labour' as const,order:10,plannedDate:'2026-11-05',start:'',end:'',pocName:'',pocPhone:'',installationDocumentsAtKarachi:false},
 {siteId:'musa-khail',siteVersion:4,kind:'labour' as const,order:11,plannedDate:'2026-11-06',start:'',end:'',pocName:'Ali',pocPhone:'0300 1234567',installationDocumentsAtKarachi:false},
];
const payload=(stops:unknown[])=>({id:randomUUID(),version:2,requestKey:randomUUID(),edit:true,team:'central',kind:'both',deliveryDate:'2026-10-29',vehicle:'PZ Bolan BYQ-241',driver:'Asif',labourTeam:'pz-team',inventoryReference:'',reason:'Check',stops});
const edited=loaded.map(s=>({...s,kind:'both' as const}));

test('Edit batch used to send display-only site facts back, so every edited batch save was refused',()=>{
 // What the page sent before this fix: the loaded sites spread as they were.
 const before=payload(edited.map(s=>({...s,start:'',end:''})));
 assert.equal(batchSchema.safeParse(before).success,false);
});

test('a batch save now sends only the accepted site fields and keeps every decision',()=>{
 const versions:Record<string,number>={'wan-bachran':5};
 const stops=batchStopsForSave(edited,id=>versions[id]);
 const parsed=batchSchema.safeParse(payload(stops));
 assert.equal(parsed.success,true,JSON.stringify(parsed.error?.issues));
 assert.deepEqual(parsed.data!.stops.map(s=>[s.siteId,s.siteVersion,s.kind,s.order,s.plannedDate,s.pocName,s.pocPhone]),[
  ['wan-bachran',5,'both',10,'2026-11-05','',''],
  ['musa-khail',4,'both',11,'2026-11-06','Ali','0300 1234567'],
 ],'work at site, order, dates and POC are kept; the latest site version is used');
 assert.equal(stops.some(s=>'installationDocumentsAtKarachi' in s),false);
});

test('real flow: an "Installation only" batch edited to "Delivery + installation" saves, and Record delivery opens',async()=>{
 const db=await testDatabase();try{
  const owner=randomUUID(),lead=randomUUID();
  for(const [id,role] of [[owner,'Admin'],[lead,'Operations']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role,role,'isolated']);
  await db.pool.query("INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,'lead','central',$2)",[lead,owner]);
  const repo=new OperationsBoardRepository(db.pool),version=async(id:string)=>(await readWorkflowSite(repo,owner,id)).version;
  await repo.importSource(owner,{sourceSha256:'f'.repeat(64),rows:['wan','musa'].map(id=>({id,ipo:'CHP-163',name:id,stage:'received',projectType:'ups',installation:true,operationsTeam:'central'}))});
  await repo.saveBatch(lead,batchSchema.parse({version:0,requestKey:randomUUID(),team:'central',kind:'labour',labourTeam:'pz-team',stops:await Promise.all(['wan','musa'].map(async(siteId,n)=>({siteId,siteVersion:await version(siteId),order:n+10,plannedDate:'2026-11-05'})))}));
  assert.equal(canRecordSiteDelivery(await readWorkflowSite(repo,owner,'wan')),false,'Installation only: no Record delivery button');
  // What Edit batch loads, with the display-only Karachi documents fact on every site.
  const loadedBatch=(await repo.batches(lead)).batches[0];assert.equal(typeof loadedBatch.stops[0].installationDocumentsAtKarachi,'boolean');
  const editedStops=loadedBatch.stops.map((s:any)=>({...s,kind:'both'}));
  const save=(stops:unknown[])=>({id:loadedBatch.id,version:loadedBatch.version,requestKey:randomUUID(),edit:true,team:'central',kind:'both',deliveryDate:'2026-10-29',vehicle:'PZ Bolan BYQ-241',driver:'Asif',labourTeam:'pz-team',inventoryReference:'',reason:'Material was delivered with this visit',stops});
  assert.equal(batchSchema.safeParse(save(editedStops.map((s:any)=>({...s,start:'',end:''})))).success,false,'the old page payload is refused');
  const versions=new Map(await Promise.all(['wan','musa'].map(async id=>[id,await version(id)] as const)));
  const saved=await repo.saveBatch(lead,batchSchema.parse(save(batchStopsForSave(editedStops,id=>versions.get(id)))));
  assert.deepEqual(saved.stops.map((s:any)=>[s.siteId,s.kind]),[['wan','both'],['musa','both']]);
  for(const id of ['wan','musa'])assert.equal(canRecordSiteDelivery(await readWorkflowSite(repo,owner,id)),true,`${id}: Record delivery is available`);
 }finally{await db.close();}
});

test('a new batch (no display-only facts, no kind or POC yet) is saved exactly as before',()=>{
 const stops=batchStopsForSave([{siteId:'one',siteVersion:1,order:1,plannedDate:''}],()=>undefined);
 assert.deepEqual(stops,[{siteId:'one',siteVersion:1,order:1,plannedDate:'',start:'',end:''}]);
 assert.equal(batchSchema.safeParse(payload(stops)).success,true);
});
