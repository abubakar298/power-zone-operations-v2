import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {testDatabase} from './database.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import {MaterialDraftRepository} from '../server/inventory/material-drafts.js';
import {NotificationsRepository} from '../server/notifications/repository.js';
import {workflowSiteSchema} from '../server/operations-board/workflow.js';
import {activeSiteAlerts,siteDelays} from '../server/operations-board/delays.js';
import {siteCancellationBlockers} from '../server/operations-board/site-cancellation.js';
import {canRecordSiteDelivery,operationsSiteBucket} from '../shared/operations-delivery-ready.js';
import type {User} from '../server/auth/repository.js';

const blocker={id:'b1',reason:'Customer not reachable',stage:'Team assignment & dispatch planning',status:'open' as const,raisedAt:'2026-11-01T10:00:00Z',raisedBy:'Lead',actorId:'x'};
const base=workflowSiteSchema.parse({id:'site',name:'Site',ipo:'IPO-1',stage:'received',installation:true,projectType:'ups',operationsTeam:'central',stageStartedAt:'2026-10-01T10:00:00Z',blockers:[blocker]});

test('current behaviour is kept for active sites; a cancelled site raises no alerts and accepts no delivery',()=>{
 // Locked before the change: an open blocker makes an alert, and the shared bucket is the stage.
 assert.equal(activeSiteAlerts([base],{},'2026-11-12T10:00:00Z').length,1);
 assert.equal(operationsSiteBucket(base),'received');
 assert.ok(siteDelays(base,{received:{amount:1,unit:'days'}},'2026-11-12T10:00:00Z').length>0);
 const cancelled={...base,cancelled:true};
 assert.equal(activeSiteAlerts([cancelled],{},'2026-11-12T10:00:00Z').length,0);
 assert.deepEqual(siteDelays(cancelled,{received:{amount:1,unit:'days'}},'2026-11-12T10:00:00Z'),[]);
 assert.equal(canRecordSiteDelivery({...cancelled,stage:'awaiting'}),false);
});

test('issued DOs and Accounts invoices refuse a cancellation',async()=>{
 const fake=(dos:string[],invoice:boolean)=>({query:async(sql:string)=>sql.includes('inventory_material_dispatches_active')?{rows:dos.map(number=>({number}))}:{rows:[],rowCount:invoice?1:0}}) as unknown as PoolClient;
 assert.deepEqual(await siteCancellationBlockers(fake([],false),'site',base),[]);
 const reasons=await siteCancellationBlockers(fake(['DO-0007'],true),'site',base);
 assert.ok(reasons.some(r=>r.includes('DO-0007')));assert.ok(reasons.some(r=>r.includes('invoice')));
 const batched=workflowSiteSchema.parse({...base,planningBatches:[{id:'b',number:'OPB-20261112-001',kind:'delivery',deliveryDate:'2026-12-01',stops:[{siteId:'site',plannedDate:'',start:'',end:''}]}]});
 assert.ok((await siteCancellationBlockers(fake([],false),'site',batched)).some(r=>r.includes('OPB-20261112-001')&&r.includes('Edit batch')));
});

test('Operations head cancels a site as a new version; everyone concerned is notified; active lists drop it',async()=>{
 const db=await testDatabase();try{
  const users:Record<string,{id:string;role:string}>={};
  for(const [key,role,name] of [['owner','Admin','Owner'],['manager','Management','Manager'],['head','Operations','Moaz Ahsan'],['lead','Operations','Central lead'],['qc','Operations','Central QC'],['inventory','Inventory','Store'],['accounts','Accounts','Salaas'],['coordinator','Coordinator','Atif']]){
   users[key]={id:randomUUID(),role};await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[users[key].id,key+'@example.invalid',name,role,'isolated']);
  }
  for(const [key,kind,team] of [['head','head',null],['lead','lead','central'],['qc','qc','central']] as const)await db.pool.query('INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,$2,$3,$4)',[users[key].id,kind,team,users.owner.id]);
  await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[users.inventory.id,users.owner.id]);
  await db.pool.query("UPDATE notification_settings SET activated_at=now()-interval '1 hour'");
  const repo=new OperationsBoardRepository(db.pool),site=(id:string,extra:Record<string,unknown>={})=>({id,ipo:'IPO-'+id,name:'Site '+id,stage:'received' as const,installation:true,projectType:'ups' as const,operationsTeam:'central' as const,...extra});
  await repo.importSource(users.owner.id,{sourceSha256:'7'.repeat(64),rows:[site('cancel-me'),site('other'),site('delivered',{stage:'delivered',deliveryDate:'2026-10-15'})]});
  // Locked before the change: the site is listed in Operations and in Inventory Upcoming Projects.
  assert.ok((await repo.sites(users.head.id)).sites.some(s=>s.id==='cancel-me'));
  assert.ok((await new MaterialDraftRepository(db.pool).intake(users.owner.id)).registeredPending.some(s=>s.siteId==='cancel-me'));

  // Proof is uploaded to the site first (PNG screenshot of the customer's email).
  const png=(text:string)=>({filename:text+'.png',mediaType:'image/png' as const,base64:Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from(text)]).toString('base64')});
  const proof=await repo.upload(users.head.id,'cancel-me',png('customer-email')),otherProof=await repo.upload(users.head.id,'other',png('other-site'));
  const cancel={action:'cancel-site' as const,version:1,edit:false,reason:'Customer cancelled the PO by email on 10 Nov.',proofIds:[proof.id],requestKey:randomUUID()};
  for(const key of ['lead','qc'])await assert.rejects(repo.command(users[key].id,'cancel-me',cancel),/Operations head or Management/);
  await assert.rejects(repo.command(users.accounts.id,'cancel-me',cancel),/document tracking only/);
  await assert.rejects(repo.command(users.head.id,'cancel-me',{...cancel,reason:' '}));
  await assert.rejects(repo.command(users.head.id,'cancel-me',{...cancel,proofIds:[]}),/Attach proof/);
  await assert.rejects(repo.command(users.head.id,'cancel-me',{...cancel,requestKey:randomUUID(),proofIds:[otherProof.id]}),/different site/);
  await assert.rejects(repo.command(users.head.id,'delivered',{...cancel,requestKey:randomUUID()}),/cannot be cancelled here because a delivery is already recorded/);

  const saved=await repo.command(users.head.id,'cancel-me',cancel);
  assert.equal(saved.version,2);assert.equal(saved.cancelled,true);
  const record=saved.cancellation as Record<string,unknown>;
  assert.deepEqual((record.proof as {id:string}[]).map(f=>f.id),[proof.id]);
  assert.equal(record.cancelledBy,'Moaz Ahsan');assert.equal(record.reason,cancel.reason);assert.equal(record.stageAtCancellation,'received');
  assert.match(String(saved.history?.at(-1)?.description),/Moaz Ahsan cancelled this site\. Reason: Customer cancelled/);
  assert.equal((await repo.command(users.head.id,'cancel-me',cancel)).version,2,'retrying the same request does not cancel twice');
  // Full history: version 1 is untouched and the decision history names who and why.
  const versions=(await db.pool.query("SELECT version,action,reason,snapshot->>'cancelled' AS cancelled FROM operations_board_versions WHERE site_id='cancel-me' ORDER BY version")).rows;
  assert.deepEqual(versions.map(v=>[v.version,v.action,v.cancelled]),[[1,'Source imported',null],[2,'cancel-site','true']]);
  assert.equal(versions[1].reason,cancel.reason);
  assert.equal((await repo.history(users.head.id,'cancel-me')).versions[0].actor,'Moaz Ahsan');

  // Read-only afterwards, for everyone including the head.
  await assert.rejects(repo.command(users.head.id,'cancel-me',{...cancel,requestKey:randomUUID(),version:2}),/was cancelled/);
  await assert.rejects(repo.command(users.lead.id,'cancel-me',{action:'blocker',text:'x',version:2,edit:false,reason:'',requestKey:randomUUID()}),/was cancelled/);
  await assert.rejects(repo.saveBatch(users.head.id,{version:0,requestKey:randomUUID(),edit:false,team:'central',kind:'delivery',deliveryDate:'2026-12-01',cancelledSites:[],vehicle:'',driver:'',inventoryReference:'',reason:'',
   stops:[{siteId:'cancel-me',siteVersion:2,order:1,plannedDate:'',start:'',end:'',pocName:'',pocPhone:''},{siteId:'other',siteVersion:1,order:2,plannedDate:'',start:'',end:'',pocName:'',pocPhone:''}]}),/was cancelled and cannot be planned/);

  // Still visible as history in Operations (the screen shows it under Cancelled); gone from Inventory.
  const listed=(await repo.sites(users.head.id)).sites.find(s=>s.id==='cancel-me');assert.equal(listed?.cancelled,true);
  const intake=await new MaterialDraftRepository(db.pool).intake(users.owner.id);
  assert.equal(intake.registeredPending.some(s=>s.siteId==='cancel-me'),false);assert.ok(intake.registeredPending.some(s=>s.siteId==='other'));

  // One in-app notice per person in every department; the person who cancelled gets none.
  const notifications=new NotificationsRepository(db.pool);await notifications.sync();await notifications.sync();
  for(const key of ['owner','manager','lead','qc','inventory','accounts','coordinator']){
   const rows=(await notifications.list(users[key] as unknown as User)).filter(n=>n.kind==='Site cancelled');
   assert.equal(rows.length,1,key+' gets one notice');
   assert.equal(rows[0].title,'Site cancelled');assert.equal(rows[0].actor,'Moaz Ahsan');
   assert.equal(rows[0].reference,'IPO-cancel-me | Site cancel-me was cancelled by Moaz Ahsan. Reason: '+cancel.reason);
  }
  assert.equal((await notifications.list(users.head as unknown as User)).filter(n=>n.kind==='Site cancelled').length,0);
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM notification_email_queue q JOIN notifications n ON n.id=q.id WHERE n.kind='Site cancelled'")).rows[0].n,0,'in-app only by default');
  for(const table of ['stock_on_hand_entries','accounts_job_closures','accounts_invoice_entries'])assert.equal((await db.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);
 }finally{await db.close();}
});
