import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {transaction} from '../server/db/transaction.js';
import {OperationsNotificationProjector,operationsNotificationRecipientAllowed} from '../server/notifications/operations-projector.js';
test('reviewed Operations projection is disabled by default, exact scoped, cutoff-safe, immutable and retry-safe',async()=>{
 const db=await testDatabase();try{
  const ids:Record<string,string>={};
  for(const [name,role]of Object.entries({owner:'Admin',head:'Operations',central:'Operations',south:'Operations',qc:'Operations',accounts:'Accounts',unassigned:'Operations',inactive:'Operations'})){
   ids[name]=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash,active) VALUES($1,$2,$3,$4,$5,$6)',[ids[name],name+'@example.test',name,role,'isolated',name!=='inactive']);
  }
  for(const [name,kind,team]of [['head','head',null],['central','lead','central'],['south','lead','south'],['qc','qc','central'],['inactive','lead','central']])await db.pool.query('INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,$2,$3,$4)',[ids[name!],kind,team,ids.owner]);
  const audiences=['management','operations-head','central-operations','south-operations','central-qc','south-qc','accounts'];
  for(const [audience,name]of [['management','owner'],['operations-head','head'],['central-operations','central'],['south-operations','south'],['central-operations','qc'],['central-qc','qc'],['south-qc','qc'],['central-operations','unassigned'],['central-operations','inactive'],['accounts','head'],['accounts','accounts']])await db.pool.query('INSERT INTO operations_notification_route_versions(audience,user_id,version,active,reviewed_by,reason) VALUES($1,$2,1,true,$3,$4)',[audience,ids[name!],ids.owner,'Reviewed fictional routing']);
  await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',['fixture-site',ids.owner]);
  const eventIds:string[]=[];
  for(const [index,date,kind]of [[1,'2026-10-26T23:59:59Z','Dispatch plan'],[2,'2026-10-27T00:00:00Z','Delivery invoice due'],[3,'2026-10-27T00:01:00Z','Site blocker raised'],[4,'2026-10-27T00:02:00Z','Saved site decision changed']] as const){
   await db.pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',['fixture-site',index,{id:'fixture-site',ipo:'IPO-FICTIONAL',name:'Fictional site',operationsTeam:'central',privateCost:999,blockerReason:'do not email'},kind,'Fixture',randomUUID(),ids.owner]);
   const id=randomUUID();eventIds.push(id);await db.pool.query('INSERT INTO operations_board_events(id,site_id,site_version,kind,audiences,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,'fixture-site',index,kind,JSON.stringify(audiences),ids.owner,date]);
  }
  await db.pool.query("INSERT INTO audit_log(user_id,target_user_id,action) VALUES($1,$1,'account.reset.completed')",[ids.owner]);
  const before=(await db.pool.query('SELECT count(*)::int AS n FROM before_operations_projection_events')).rows[0].n;
  const projector=new OperationsNotificationProjector(),sync=()=>transaction(db.pool,c=>projector.sync(c,'2026-10-27T01:00:00Z'));
  assert.deepEqual(await sync(),{enabled:false,created:0,heldBlockerEvents:0});
  await db.pool.query("INSERT INTO operations_notification_policy_versions(version,enabled,activated_at,reviewed_by,reason) VALUES(2,true,'2026-10-27T00:00:00Z',$1,'Reviewed activation')",[ids.owner]);
  assert.deepEqual(await sync(),{enabled:true,created:10,heldBlockerEvents:1});
  assert.deepEqual(await sync(),{enabled:true,created:0,heldBlockerEvents:1});
  const intents=(await db.pool.query('SELECT * FROM operations_notification_intents ORDER BY event_id,user_id')).rows;
  assert.equal(intents.length,10);assert.ok(intents.every(r=>[eventIds[1],eventIds[3]].includes(r.event_id)));assert.ok(intents.every(r=>[ids.owner,ids.head,ids.central,ids.qc,ids.accounts].includes(r.user_id)));
  assert.ok(!JSON.stringify(intents).includes('privateCost'));assert.ok(!JSON.stringify(intents).includes('do not email'));
  assert.ok(intents.filter(r=>r.audience==='accounts').every(r=>r.target.target==='finance'));
  assert.ok(intents.filter(r=>r.audience!=='accounts').every(r=>r.target.path==='/operations/sites/fixture-site'));
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM before_operations_projection_events')).rows[0].n,before);
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM notification_events WHERE source_key LIKE 'operations-notice:%'")).rows[0].n,10);
  const central=intents.find(r=>r.user_id===ids.central)!,sourceKey='operations-notice:'+central.id;
  assert.equal(await transaction(db.pool,c=>operationsNotificationRecipientAllowed(c,sourceKey,ids.central)),true);
  assert.equal(await transaction(db.pool,c=>operationsNotificationRecipientAllowed(c,sourceKey,ids.south)),false);
  assert.equal(await transaction(db.pool,c=>operationsNotificationRecipientAllowed(c,'operations-notice:------------------------------------',ids.central)),false);
  await db.pool.query('UPDATE users SET active=false WHERE id=$1',[ids.central]);
  assert.equal(await transaction(db.pool,c=>operationsNotificationRecipientAllowed(c,sourceKey,ids.central)),false);
  await db.pool.query('UPDATE users SET active=true WHERE id=$1',[ids.central]);
  await db.pool.query("INSERT INTO operations_notification_route_versions(audience,user_id,version,active,reviewed_by,reason) VALUES('central-operations',$1,2,false,$2,'Revoked')",[ids.central,ids.owner]);
  assert.equal(await transaction(db.pool,c=>operationsNotificationRecipientAllowed(c,sourceKey,ids.central)),false);
  assert.equal((await sync()).created,0,'Revocation never recreates an intent');
  const head=intents.find(r=>r.user_id===ids.head)!;
  await db.pool.query("UPDATE users SET role='Inventory' WHERE id=$1",[ids.head]);
  assert.equal(await transaction(db.pool,c=>operationsNotificationRecipientAllowed(c,'operations-notice:'+head.id,ids.head)),false,'A retained notice cannot outlive its role boundary');
  await db.pool.query("INSERT INTO operations_notification_route_versions(audience,user_id,version,active,reviewed_by,reason) VALUES('central-operations',$1,3,true,$2,'Reviewed restoration')",[ids.central,ids.owner]);
  assert.equal(await transaction(db.pool,c=>operationsNotificationRecipientAllowed(c,sourceKey,ids.central)),true);
  await db.pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,5,$2,$3,$4,$5,$6)',['fixture-site',{id:'fixture-site',ipo:'IPO-FICTIONAL',name:'Fictional site',operationsTeam:'south'},'assign-team','Reviewed transfer',randomUUID(),ids.owner]);
  assert.equal(await transaction(db.pool,c=>operationsNotificationRecipientAllowed(c,sourceKey,ids.central)),false,'Current site transfer removes former team visibility');
  assert.equal((await sync()).created,0,'Historical event is not broadcast to a newly assigned team');
  await db.pool.query("INSERT INTO operations_notification_policy_versions(version,enabled,reviewed_by,reason) VALUES(3,false,$1,'Pause delivery')",[ids.owner]);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM operations_notification_eligible_intents')).rows[0].n,0);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM operations_notification_intents')).rows[0].n,10,'Revocation preserves immutable delivery history');
  await assert.rejects(db.pool.query("UPDATE operations_notification_intents SET reference='overwrite'"));
  await assert.rejects(db.pool.query('DELETE FROM operations_notification_route_versions'));
  await assert.rejects(db.pool.query('DELETE FROM operations_notification_policy_versions'));
  await assert.rejects(transaction(db.pool,c=>projector.sync(c,'2026-02-30T00:00:00Z')),/valid projection clock/);
  for(const table of ['notification_email_queue','stock_on_hand_entries','internal_purchase_orders','accounts_job_closures'])assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n,0);
 }finally{await db.close();}
});
