import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import {batchSchema} from '../server/operations-board/schema.js';

test('shared batch bookings are atomic, versioned and resource-conflict safe without posting dispatch or completing sites',async()=>{
 const db=await testDatabase();try{
  const owner=randomUUID(),qc=randomUUID(),lead=randomUUID();
  for(const [id,role] of [[owner,'Admin'],[qc,'Operations'],[lead,'Operations']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role,role,'isolated']);
  for(const [id,kind,team] of [[qc,'qc','central'],[lead,'lead','central']])await db.pool.query('INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,$2,$3,$4)',[id,kind,team,owner]);
  const repo=new OperationsBoardRepository(db.pool),ids=['one','two','three','four','five','six'];
  await repo.importSource(owner,{sourceSha256:'a'.repeat(64),rows:ids.map(id=>({id,ipo:id,name:id,stage:'received',projectType:'ups',installation:true,operationsTeam:null}))});
  const input=async(chosen:string[],vehicle='ABC-123')=>batchSchema.parse({version:0,requestKey:randomUUID(),team:'central',kind:'both',vehicle,driver:'Test driver',labourTeam:'pz-team',stops:await Promise.all(chosen.map(async(siteId,n)=>({siteId,siteVersion:(await repo.site(owner,siteId)).version,order:n+1,plannedDate:'2026-10-28',start:n?'10:30':'08:00',end:n?'12:30':'10:00'})))});
  const first=await input(['one','two']);
  await assert.rejects(repo.saveBatch(qc,first),/Operations lead/);await assert.rejects(repo.saveBatch(lead,first),/not found/);
  const booked=await repo.saveBatch(owner,first);assert.equal(booked.version,1);assert.equal((await repo.saveBatch(owner,first)).id,booked.id);
  for(const id of ['one','two']){const s=await repo.site(owner,id);assert.equal(s.operationsTeam,'central');assert.equal(s.installationPlanDate,'2026-10-28','Combined route preserves its installation planning date');assert.equal(s.stage,'received','missing vendors must remain pending, not look dispatch-ready');assert.equal(s.completed,undefined);assert.equal((s as any).planningBatches[0].stops.length,1,'site snapshots contain their own stop only');}
  await assert.rejects(repo.saveBatch(owner,await input(['three','four'],'a b c 1 2 3')),/already booked/);
  const before=(await db.pool.query('SELECT count(*)::int AS n FROM operations_board_batch_versions')).rows[0].n;
  const invalid=await input(['three','four'],'DEF-999');invalid.stops[1].start='09:00';await assert.rejects(repo.saveBatch(owner,invalid),/overlap/);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM operations_board_batch_versions')).rows[0].n,before);assert.equal((await repo.site(owner,'three')).operationsTeam,null);
  const update=batchSchema.parse({...first,id:booked.id,version:1,requestKey:randomUUID(),stops:await Promise.all(first.stops.map(async s=>({...s,siteVersion:(await repo.site(owner,s.siteId)).version,start:s.order===1?'13:00':'15:30',end:s.order===1?'15:00':'17:30'})))});
  await assert.rejects(repo.saveBatch(owner,update),/locked/);await assert.rejects(repo.saveBatch(owner,{...update,edit:true}),/reason/);
  const edited=await repo.saveBatch(owner,{...update,edit:true,reason:'Customer requested afternoon'});assert.equal(edited.version,2);assert.equal((await repo.batches(lead)).batches.length,1);
  const a=await input(['three','four'],'SHARED-2'),b=await input(['five','six'],'shared2');
  // Use a different date so this case isolates its own concurrent booking.
  for(const v of [a,b])for(const stop of v.stops)stop.plannedDate='2026-10-29';
  const concurrent=await Promise.allSettled([repo.saveBatch(owner,a),repo.saveBatch(owner,b)]);assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(concurrent.filter(r=>r.status==='rejected').length,1);
  const one=await repo.site(owner,'one');await repo.command(owner,'one',{action:'assign-team',team:'south',version:one.version,requestKey:randomUUID(),edit:true,reason:'Regional reassignment'});
  const scoped=await repo.batches(lead);assert.equal(scoped.batches.find(b=>b.id===booked.id)!.stops.some(s=>s.siteId==='one'),false);assert.equal(scoped.batches.find(b=>b.id===booked.id)!.canEdit,false);
  await assert.rejects(repo.saveBatch(lead,first),/not found/);
  await repo.importSource(owner,{sourceSha256:'b'.repeat(64),rows:['installed-route-a','installed-route-b'].map(id=>({id,ipo:id,name:id,stage:'delivered',projectType:'ups',installation:true,completed:false,operationsTeam:'central',deliveryDate:'2026-10-27'}))});
  const installation=batchSchema.parse({version:0,requestKey:randomUUID(),team:'central',kind:'labour',labourTeam:'pz-team',stops:await Promise.all(['installed-route-a','installed-route-b'].map(async(siteId,n)=>({siteId,siteVersion:(await repo.site(owner,siteId)).version,order:n+1,plannedDate:'2026-11-01'})))});
  const installationBatch=await repo.saveBatch(owner,installation);assert.equal(installationBatch.stops.length,2);assert.ok(installationBatch.stops.every(s=>s.start===''&&s.end===''));
  for(const stop of installationBatch.stops){const site=await repo.site(owner,stop.siteId);assert.equal(site.stage,'delivered');assert.equal(site.completed,false);assert.equal(site.deliveryDate,'2026-10-27');assert.equal(site.dispatchDate,undefined);assert.equal(site.accounts?.find((e:any)=>e.type==='Batch plan')?.dispatchDate,undefined,'installation route cannot notify Accounts of a new delivery');}
  await repo.importSource(owner,{sourceSha256:'c'.repeat(64),rows:[{id:'mixed-install',ipo:'MIX-I',name:'Delivered site',stage:'delivered',projectType:'ups',installation:true,completed:false,operationsTeam:'central',deliveryDate:'2026-10-27'},...['mixed-deliver','mixed-both'].map(id=>({id,ipo:id,name:id,stage:'received',projectType:'ups',installation:true,operationsTeam:'central'}))]});
  const mixed=batchSchema.parse({version:0,requestKey:randomUUID(),team:'central',kind:'both',vehicle:'MIX-123',driver:'Route driver',labourTeam:'pz-team',stops:await Promise.all(['mixed-install','mixed-deliver','mixed-both'].map(async(siteId,n)=>({siteId,siteVersion:(await repo.site(owner,siteId)).version,kind:['labour','delivery','both'][n],order:n+1,plannedDate:'2026-11-02'})))});
  const savedMixed=await repo.saveBatch(owner,mixed);assert.deepEqual(savedMixed.stops.map(s=>s.kind),['labour','delivery','both']);
  assert.equal((await repo.saveBatch(owner,mixed)).id,savedMixed.id,'mixed routes replay without duplicate work');
  for(const stop of mixed.stops){const current=await repo.site(owner,stop.siteId);const event=current.accounts.find(e=>e.type==='Batch plan');assert.equal(event?.dispatchDate,stop.kind==='labour'?undefined:stop.plannedDate);assert.equal(current.stage,stop.kind==='labour'?'delivered':'received');assert.equal(current.planningBatches[0].stops[0].kind,stop.kind);}
  await assert.rejects(repo.saveBatch(owner,{...mixed,requestKey:randomUUID(),kind:'delivery',stops:await Promise.all(mixed.stops.map(async stop=>({...stop,siteVersion:(await repo.site(owner,stop.siteId)).version})))}),/resources must match/);
  await repo.importSource(owner,{sourceSha256:'d'.repeat(64),rows:[{id:'add-central',ipo:'ADD-C',name:'Additional Central IPO',stage:'received',projectType:'ups',installation:true,operationsTeam:'central'},{id:'add-south',ipo:'ADD-S',name:'South IPO',stage:'received',projectType:'ups',installation:true,operationsTeam:'south'},{id:'add-completed',ipo:'ADD-DONE',name:'Completed IPO',stage:'delivered',projectType:'ups',installation:false,completed:true,operationsTeam:'central'}]});
  const extension=async(newId:string)=>batchSchema.parse({...mixed,id:savedMixed.id,version:1,requestKey:randomUUID(),edit:true,reason:'Add another IPO on the same route',stops:await Promise.all([...mixed.stops,{siteId:newId,siteVersion:1,kind:'both',order:4,plannedDate:'2026-11-02',start:'',end:''}].map(async stop=>({...stop,siteVersion:(await repo.site(owner,stop.siteId)).version})))});
  await assert.rejects(repo.saveBatch(lead,await extension('add-south')),/not found/);
  await assert.rejects(repo.saveBatch(lead,await extension('add-completed')),/not eligible/);
  const addition=await extension('add-central');
  await assert.rejects(repo.saveBatch(qc,addition),/Operations lead/);
  await assert.rejects(repo.saveBatch(lead,{...addition,stops:addition.stops.slice(1)}),/Keep existing sites/);
  const extended=await repo.saveBatch(lead,addition);assert.equal(extended.id,savedMixed.id);assert.equal(extended.number,savedMixed.number);assert.equal(extended.version,2);assert.equal(extended.stops.length,4);assert.deepEqual(extended.stops.slice(0,3).map(stop=>stop.kind),['labour','delivery','both']);
  assert.equal((await repo.saveBatch(lead,addition)).version,2,'retrying an addition does not duplicate stops');
  assert.equal((await repo.batches(lead)).batches.find(batch=>batch.id===savedMixed.id)?.canEdit,true);
  const added=await repo.site(owner,'add-central');assert.equal(added.planningBatches[0].id,savedMixed.id);assert.equal(added.planningBatches[0].stops.length,1);assert.equal(added.planningBatches[0].stops[0].kind,'both');assert.equal(added.accounts.find(e=>e.type==='Batch plan')?.dispatchDate,'2026-11-02');
  await assert.rejects(repo.saveBatch(lead,{...addition,requestKey:randomUUID()}),/batch was updated/);
  for(const table of ['internal_purchase_orders','accounts_job_closures','stock_on_hand_entries'])assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n,0);
 }finally{await db.close();}
});
