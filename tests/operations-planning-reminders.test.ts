import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {transaction} from '../server/db/transaction.js';
import {addWorkingMs,planningReminder,workingMsBetween,PlanningReminderProjector} from '../server/operations-board/planning-reminders.js';
import {NotificationsRepository} from '../server/notifications/repository.js';

const H=3600000;
// Pakistan time is UTC+5. 2026-11-06 is a Friday.
const pk=(local:string)=>Date.parse(local+'+05:00');

test('48 working hours count Monday to Friday only (Pakistan time)',()=>{
 // Monday 10:00 → Wednesday 10:00.
 assert.equal(new Date(addWorkingMs(pk('2026-11-02T10:00:00'),48*H)).toISOString(),new Date(pk('2026-11-04T10:00:00')).toISOString());
 // Friday 17:00 → Tuesday 17:00 (Saturday and Sunday are skipped).
 assert.equal(new Date(addWorkingMs(pk('2026-11-06T17:00:00'),48*H)).toISOString(),new Date(pk('2026-11-10T17:00:00')).toISOString());
 // An IPO received on Saturday starts counting on Monday 00:00.
 assert.equal(new Date(addWorkingMs(pk('2026-11-07T12:00:00'),48*H)).toISOString(),new Date(pk('2026-11-11T00:00:00')).toISOString());
 assert.equal(workingMsBetween(pk('2026-11-06T17:00:00'),pk('2026-11-09T17:00:00')),24*H,'the weekend does not count');
});

test('no alert inside 48 working hours, then one every 12 working hours',()=>{
 const start=pk('2026-11-02T10:00:00');
 assert.equal(planningReminder(start,pk('2026-11-04T09:59:00')),null);
 assert.equal(planningReminder(start,pk('2026-11-04T10:00:00'))?.sequence,0);
 assert.equal(planningReminder(start,pk('2026-11-04T21:59:00'))?.sequence,0);
 assert.equal(planningReminder(start,pk('2026-11-04T22:00:00'))?.sequence,1);
 assert.equal(planningReminder(start,pk('2026-11-05T10:00:00'))?.sequence,2);
 // Friday 22:00 is reminder 5; the weekend adds none; Monday 10:00 is reminder 6.
 assert.equal(planningReminder(start,pk('2026-11-06T22:00:00'))?.sequence,5);
 assert.equal(planningReminder(start,pk('2026-11-08T23:00:00'))?.sequence,5);
 assert.equal(planningReminder(start,pk('2026-11-09T10:00:00'))?.sequence,6);
});

test('unplanned IPO sends "Planning pending" to Operations heads and the site team leads, repeats every 12 hours, and clears once planned',async()=>{
 const db=await testDatabase();try{
  const users:Record<string,string>={};
  for(const [name,role] of Object.entries({owner:'Admin',head:'Operations',lead:'Operations',southLead:'Operations',qc:'Operations',coordinator:'Coordinator'})){
   users[name]=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[users[name],name.toLowerCase()+'@example.test',name,role,'isolated']);
  }
  for(const [name,kind,team] of [['head','head',null],['lead','lead','central'],['southLead','lead','south'],['qc','qc','central']])
   await db.pool.query('INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,$2,$3,$4)',[users[name!],kind,team,users.owner]);
  await db.pool.query("UPDATE operations_planning_reminder_settings SET activated_at='2026-10-01T00:00:00Z'");
  let version=0;const snapshot:any={id:'site-1',ipo:'IPO-1001',name:'Fictional site',stage:'received',installation:true,projectType:'solar',operationsTeam:'central',stageStartedAt:new Date(pk('2026-11-02T10:00:00')).toISOString(),history:[]};
  const save=async(change:any={})=>{if(!version)await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',['site-1',users.owner]);Object.assign(snapshot,change);await db.pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',['site-1',++version,snapshot,'Fixture','Fixture',randomUUID(),users.owner]);};
  await save();
  const sync=(local:string)=>transaction(db.pool,c=>new PlanningReminderProjector().sync(c,new Date(pk(local)).toISOString()));
  const live=async()=>(await db.pool.query("SELECT user_id,source_key,kind,reference,target FROM notifications WHERE source_key LIKE 'planning-reminder:%' AND resolved_at IS NULL ORDER BY source_key")).rows;
  await sync('2026-11-04T09:00:00');assert.equal((await live()).length,0,'still inside the 48 working hours');
  await sync('2026-11-04T10:30:00');
  let rows=await live();
  assert.deepEqual(rows.map(r=>r.user_id).sort(),[users.head,users.lead].sort(),'head and the central lead only');
  assert.equal(rows[0].kind,'Planning pending');assert.match(rows[0].reference,/^IPO-1001 \| Fictional site · Planning was due 04 Nov 2026/);
  assert.deepEqual(rows[0].target,{path:'/operations/sites/site-1'});
  await sync('2026-11-04T11:00:00');assert.equal((await live()).length,2,'no duplicate inside the same 12 hours');
  // The bell shows it with its title.
  const repo=new NotificationsRepository(db.pool);
  const inbox=await repo.list({id:users.lead,role:'Operations'} as any);
  assert.equal(inbox.length,1);assert.equal(inbox[0].title,'IPO planning pending');
  assert.equal((await repo.list({id:users.coordinator,role:'Coordinator'} as any)).length,0);
  await sync('2026-11-04T22:00:00');
  rows=await live();assert.equal(rows.length,2,'the new reminder replaces the old one');assert.ok(rows.every(r=>r.source_key.includes(':1:')));
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM notifications WHERE source_key LIKE 'planning-reminder:%'")).rows[0].n,4);
  // Planning saved: the alert clears.
  await save({stage:'awaiting',dispatchDate:'2026-11-10',planSavedAt:new Date().toISOString()});
  await sync('2026-11-05T10:00:00');
  assert.equal((await live()).length,0);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM operations_planning_reminders')).rows[0].n,2,'no new reminder once planned');
 }finally{await db.close();}
});

test('solar only: UPS, BESS-only and delivery-only sites get no alert; a solar site with no team alerts every lead; an older pending site gets 48 working hours from go-live',async()=>{
 const db=await testDatabase();try{
  const users:Record<string,string>={};
  for(const name of ['owner','lead','southlead']){users[name]=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[users[name],name+'@example.test',name,name==='owner'?'Admin':'Operations','isolated']);}
  for(const [name,team] of [['lead','central'],['southlead','south']])await db.pool.query("INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,'lead',$2,$3)",[users[name],team,users.owner]);
  await db.pool.query("UPDATE operations_planning_reminder_settings SET activated_at=$1",[new Date(pk('2026-11-02T10:00:00')).toISOString()]);
  await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',['old',users.owner]);
  await db.pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,$3,$4,$5,$6)',['old',{id:'old',ipo:'IPO-9',name:'Old site',stage:'received',projectType:'solar-bess',operationsTeam:null,stageStartedAt:'2026-09-01T00:00:00.000Z'},'Fixture','Fixture',randomUUID(),users.owner]);
  for(const [id,projectType] of [['ups','ups'],['bess','bess'],['delivery','delivery-only']]){await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[id,users.owner]);await db.pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,$3,$4,$5,$6)',[id,{id,ipo:'IPO-'+id,name:id,stage:'received',projectType,operationsTeam:'central',stageStartedAt:'2026-09-01T00:00:00.000Z'},'Fixture','Fixture',randomUUID(),users.owner]);}
  const sync=(local:string)=>transaction(db.pool,c=>new PlanningReminderProjector().sync(c,new Date(pk(local)).toISOString()));
  await sync('2026-11-03T10:00:00');assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n,0);
  await sync('2026-11-04T10:00:00');
  assert.deepEqual((await db.pool.query("SELECT user_id FROM notifications WHERE source_key LIKE 'planning-reminder:%'")).rows.map(r=>r.user_id).sort(),[users.lead,users.southlead].sort());
  assert.deepEqual((await db.pool.query('SELECT DISTINCT site_id FROM operations_planning_reminders')).rows.map(r=>r.site_id),['old'],'only the solar site');
 }finally{await db.close();}
});
