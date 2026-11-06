import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {transaction} from '../server/db/transaction.js';
import {OperationsIncidentProjector} from '../server/notifications/operations-incidents.js';
import {operationsNotificationRecipientAllowed} from '../server/notifications/operations-projector.js';
test('stage incident sends reviewed QC then immediate blocker tiers once, stable across edits and safely scoped',async()=>{
 const db=await testDatabase();try{
  const users:Record<string,string>={};
  for(const [name,role]of Object.entries({owner:'Admin',head:'Operations',qc:'Operations',lead:'Operations',southQc:'Operations',southLead:'Operations'})){
   users[name]=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[users[name],name.toLowerCase()+'@example.test',name,role,'isolated']);
  }
  for(const [name,kind,team,audience]of [['head','head',null,'operations-head'],['qc','qc','central','central-qc'],['lead','lead','central','central-operations'],['southQc','qc','south','south-qc'],['southLead','lead','south','south-operations']]){
   await db.pool.query('INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,$2,$3,$4)',[users[name!],kind,team,users.owner]);
   await db.pool.query('INSERT INTO operations_notification_route_versions(audience,user_id,version,active,reviewed_by,reason) VALUES($1,$2,1,true,$3,$4)',[audience,users[name!],users.owner,'Reviewed fictional route']);
  }
  await db.pool.query("INSERT INTO operations_notification_route_versions(audience,user_id,version,active,reviewed_by,reason) VALUES('management',$1,1,true,$1,'Reviewed owner')",[users.owner]);
  const targets=async(version:number,hours:number)=>db.pool.query('INSERT INTO operations_board_target_versions(version,values,request_key,reason,created_by,request_sha256) VALUES($1,$2,$3,$4,$5,$6)',[version,{'ups:job':{amount:hours,unit:'hours'}},randomUUID(),'Reviewed target',users.owner,'a'.repeat(64)]);
  await targets(1,1);
  const snapshots:Record<string,any>={};
  const save=async(id:string,version:number,change:any={})=>{
   if(version===1){await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[id,users.owner]);snapshots[id]={id,ipo:'FICTIONAL-IPO',name:'Fictional site',stage:'delivered',installation:true,projectType:'ups',operationsTeam:'central',deliveryRecordedAt:'2026-10-27T00:00:00Z',deliveryDate:'2026-10-27',documents:[],blockers:[],accounts:[],history:[],planningBatches:[]};}
   snapshots[id]={...snapshots[id],...change};await db.pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,version,snapshots[id],'Fixture progression','Fixture',randomUUID(),users.owner]);
  };
  await save('main',1);
  const projector=new OperationsIncidentProjector(),sync=(clock:string)=>transaction(db.pool,c=>projector.sync(c,clock));
  assert.equal((await sync('2026-10-27T00:59:59Z')).enabled,false);
  await db.pool.query("INSERT INTO operations_notification_policy_versions(version,enabled,activated_at,reviewed_by,reason) VALUES(2,true,'2026-10-27T00:00:00Z',$1,'Reviewed activation')",[users.owner]);
  assert.equal((await sync('2026-10-27T00:59:59Z')).created,0);
  assert.equal((await sync('2026-10-27T01:00:00Z')).created,1);
  let intents=(await db.pool.query('SELECT * FROM operations_notification_incident_intents')).rows;
  assert.equal(intents[0].user_id,users.qc);assert.equal(intents[0].tier,'assigned');const stableId=intents[0].incident_id,sourceKey='operations-notice:'+intents[0].id;
  assert.equal(await transaction(db.pool,c=>operationsNotificationRecipientAllowed(c,sourceKey,users.qc)),true);
  const blocker={id:randomUUID(),raisedBy:'Fixture QC',actorId:users.qc,stage:'UPS job completion',status:'open',reason:'Private reason stays on site',raisedAt:'2026-10-27T01:05:00Z'};
  await save('main',2,{blockers:[blocker]});
  assert.equal((await sync('2026-10-27T01:05:00Z')).created,3,'QC already reserved; lead, head and owner receive blocker');
  assert.equal((await sync('2026-10-27T01:05:00Z')).created,0);
  intents=(await db.pool.query('SELECT * FROM operations_notification_incident_intents')).rows;
  assert.equal(intents.length,4);assert.ok(intents.every(r=>r.incident_id===stableId));assert.ok(!JSON.stringify(intents).includes('Private reason'));
  await save('main',3,{blockers:[{...blocker,status:'resolved',resolution:'Ready',resolvedAt:'2026-10-27T01:10:00Z'}]});
  await targets(2,2);assert.equal(await transaction(db.pool,c=>operationsNotificationRecipientAllowed(c,sourceKey,users.qc)),false,'New target invalidates stale queued visibility before projection');assert.equal((await sync('2026-10-27T01:10:00Z')).created,0);
  assert.equal((await db.pool.query('SELECT incident_id FROM operations_notification_incident_state WHERE site_id=$1',['main'])).rows[0].incident_id,stableId);
  assert.equal((await sync('2026-10-27T03:00:00Z')).created,0,'Target edits do not resend an already notified person');
  await targets(3,1);assert.equal((await sync('2026-10-27T03:00:00Z')).created,0);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_notification_eligible_incident_intents')).rows[0].n,3,'Resolved blocker no longer addresses head; delay tiers remain');
  await save('main',4,{operationsTeam:'south'});
  assert.equal(await transaction(db.pool,c=>operationsNotificationRecipientAllowed(c,sourceKey,users.qc)),false,'Unsynced snapshot change hides stale pending notices');
  assert.equal((await sync('2026-10-27T03:00:00Z')).created,2,'New exact South QC/lead routes receive their own responsibility');
  assert.equal(await transaction(db.pool,c=>operationsNotificationRecipientAllowed(c,sourceKey,users.qc)),false);
  await save('main',5,{completed:true,documentsSubmittedToAccounts:true});
  await sync('2026-10-27T04:00:00Z');assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_notification_eligible_incident_intents')).rows[0].n,0);
  await save('unknown',1,{deliveryRecordedAt:undefined,deliveryDate:undefined});
  const unknown=await sync('2026-10-27T04:00:00Z');assert.ok(unknown.held.find(r=>r.siteId==='unknown')?.reasons.includes('Stage start is missing or invalid.'));assert.equal(unknown.created,0);
  await save('unknown',2,{blockers:[{...blocker,id:randomUUID(),raisedAt:'2026-10-27T04:01:00Z'}]});
  assert.equal((await sync('2026-10-27T04:01:00Z')).created,4,'Explicit new blocker needs no fabricated stage clock');
  await save('old',1,{deliveryRecordedAt:'2026-10-26T00:00:00Z',deliveryDate:'2026-10-26'});
  const old=await sync('2026-10-27T04:01:00Z');assert.equal(old.created,0);assert.ok(old.held.find(r=>r.siteId==='old')?.reasons.some(r=>r.includes('before activation')));
  const count=(await db.pool.query('SELECT count(*)::int n FROM operations_notification_incident_observations')).rows[0].n;
  await sync('2026-10-27T04:01:00Z');assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_notification_incident_observations')).rows[0].n,count,'Identical polling does not append redundant observations');
  // Re-entering the same named stage must not make an old blocker new again.
  await save('main',6,{completed:false,documentsSubmittedToAccounts:false,deliveryRecordedAt:'2026-10-27T04:00:00Z',blockers:[blocker]});
  const reentry=await sync('2026-10-27T04:10:00Z');
  assert.equal(reentry.created,0);assert.ok(reentry.held.find(r=>r.siteId==='main')?.reasons.some(r=>r.includes('another stage occurrence')));
  const reentryId=(await db.pool.query('SELECT incident_id FROM operations_notification_incident_state WHERE site_id=$1',['main'])).rows[0].incident_id;
  assert.notEqual(reentryId,stableId);
  await save('main',7,{blockers:[blocker,{...blocker,id:randomUUID(),raisedAt:'2026-10-27T04:11:00Z'}]});
  assert.equal((await sync('2026-10-27T04:11:00Z')).created,4,'A genuinely new blocker in the new occurrence can notify its current team');
  // More invalid rows than the scan limit must not starve a valid later site.
  await db.pool.query(`INSERT INTO operations_board_sites(id,created_by) SELECT 'invalid-'||lpad(n::text,3,'0'),$1 FROM generate_series(1,251)n`,[users.owner]);
  await db.pool.query(`INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by)
   SELECT id,1,jsonb_build_object('id',id,'name','Invalid fixture','ipo','FICTIONAL','stage','unsupported','installation',true),'Fixture','Invalid workflow test',gen_random_uuid(),$1
   FROM operations_board_sites WHERE id LIKE 'invalid-%'`,[users.owner]);
  await save('zz-valid',1,{deliveryRecordedAt:'2026-10-27T04:00:00Z',blockers:[]});
  await db.pool.query('UPDATE operations_notification_scan_cursor SET after_site_id=NULL WHERE singleton');
  const firstScan=await sync('2026-10-27T05:00:00Z');assert.equal(firstScan.evaluated,250);
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM operations_notification_incident_intents i JOIN operations_notification_incidents n ON n.id=i.incident_id WHERE n.site_id='zz-valid'")).rows[0].n,0);
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM operations_notification_incident_state WHERE site_id LIKE 'invalid-%' AND incident_id IS NULL AND stage_key IS NULL AND NOT active AND cardinality(eligible_recipients)=0")).rows[0].n,250,'Invalid rows advance cursor without a fabricated incident');
  await sync('2026-10-27T05:00:01Z');
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM operations_notification_incident_intents i JOIN operations_notification_incidents n ON n.id=i.incident_id WHERE n.site_id='zz-valid'")).rows[0].n,1,'Next tick reaches the valid later row');
  await assert.rejects(db.pool.query('DELETE FROM operations_notification_incident_intents'));await assert.rejects(db.pool.query('DELETE FROM operations_notification_incidents'));await assert.rejects(db.pool.query('DELETE FROM operations_notification_incident_observations'));
  for(const table of ['stock_on_hand_entries','internal_purchase_orders','accounts_job_closures','notification_email_queue'])assert.equal((await db.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);
 }finally{await db.close();}
});

test('381-site unchanged polling writes only one durable cursor, while due/target/role/source changes invalidate correctly',async()=>{
 const db=await testDatabase();try{
  const users:Record<string,string>={};
  for(const [name,role]of Object.entries({owner:'Admin',head:'Operations',qc:'Operations',lead:'Operations'})){
   users[name]=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[users[name],name+'@example.test',name,role,'isolated']);
  }
  for(const [name,kind,audience]of [['head','head','operations-head'],['qc','qc','central-qc'],['lead','lead','central-operations']]){
   await db.pool.query('INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,$2,$3,$4)',[users[name!],kind,kind==='head'?null:'central',users.owner]);
   await db.pool.query('INSERT INTO operations_notification_route_versions(audience,user_id,version,active,reviewed_by,reason) VALUES($1,$2,1,true,$3,$4)',[audience,users[name!],users.owner,'Reviewed fictional route']);
  }
  await db.pool.query("INSERT INTO operations_notification_route_versions(audience,user_id,version,active,reviewed_by,reason) VALUES('management',$1,1,true,$1,'Reviewed owner')",[users.owner]);
  await db.pool.query("INSERT INTO operations_notification_policy_versions(version,enabled,activated_at,reviewed_by,reason) VALUES(2,true,'2026-10-27T00:00:00Z',$1,'Reviewed activation')",[users.owner]);
  const targets=async(version:number,hours:number)=>db.pool.query('INSERT INTO operations_board_target_versions(version,values,request_key,reason,created_by,request_sha256) VALUES($1,$2,$3,$4,$5,$6)',[version,{'ups:job':{amount:hours,unit:'hours'}},randomUUID(),'Reviewed target',users.owner,'b'.repeat(64)]);
  await targets(1,1);
  await db.pool.query("INSERT INTO operations_board_sites(id,created_by) SELECT 'benchmark-'||lpad(n::text,3,'0'),$1 FROM generate_series(1,381)n",[users.owner]);
  await db.pool.query(`INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by)
   SELECT id,1,jsonb_build_object('id',id,'ipo','FICTIONAL','name','Fictional benchmark site','stage','delivered','installation',true,'projectType','ups','operationsTeam','central','deliveryRecordedAt','2026-10-27T00:00:00Z','deliveryDate','2026-10-27','documents','[]'::jsonb,'blockers','[]'::jsonb,'accounts','[]'::jsonb,'history','[]'::jsonb,'planningBatches','[]'::jsonb),'Fixture','381 fictional sites',gen_random_uuid(),$1 FROM operations_board_sites`,[users.owner]);
  const projector=new OperationsIncidentProjector();
  const sync=(clock:string)=>transaction(db.pool,c=>projector.sync(c,clock));
  await sync('2026-10-27T00:00:10Z');await sync('2026-10-27T00:00:20Z');
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_notification_incident_state')).rows[0].n,381);
  const before=(await db.pool.query('SELECT count(*)::int n FROM operations_notification_incident_observations')).rows[0].n;
  const measured=[];
  for(const clock of ['2026-10-27T00:00:30Z','2026-10-27T00:00:40Z','2026-10-27T00:00:50Z']){
   const counts={queries:0,cursorUpdates:0,incidentWrites:0,stateWrites:0,observationWrites:0,intentWrites:0};
   const started=performance.now();
   const result=await transaction(db.pool,async c=>{
    const original=c.query.bind(c);
    (c as any).query=async(...args:any[])=>{
     const sql=String(typeof args[0]==='string'?args[0]:args[0]?.text??'');counts.queries++;
     if(/^\s*UPDATE operations_notification_scan_cursor/.test(sql))counts.cursorUpdates++;
     if(/^\s*(INSERT INTO|UPDATE|DELETE FROM) operations_notification_incidents(?:\(|\s)/.test(sql))counts.incidentWrites++;
     if(/^\s*(INSERT INTO|UPDATE|DELETE FROM) operations_notification_incident_state(?:\(|\s)/.test(sql))counts.stateWrites++;
     if(/^\s*(INSERT INTO|UPDATE|DELETE FROM) operations_notification_incident_observations(?:\(|\s)/.test(sql))counts.observationWrites++;
     if(/^\s*(INSERT INTO|UPDATE|DELETE FROM) operations_notification_incident_intents(?:\(|\s)/.test(sql))counts.intentWrites++;
     return (original as any)(...args);
    };
    try{return await projector.sync(c,clock);}finally{(c as any).query=original;}
   });
   assert.equal(result.evaluated,250);assert.equal(result.created,0);assert.equal(counts.cursorUpdates,1);
   assert.deepEqual([counts.incidentWrites,counts.stateWrites,counts.observationWrites,counts.intentWrites],[0,0,0,0]);
   measured.push({...counts,elapsedMs:Number((performance.now()-started).toFixed(3))});
  }
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_notification_incident_observations')).rows[0].n,before);
  console.log('381-site unchanged native projection measurements (transaction included): '+JSON.stringify(measured));
  await sync('2026-10-27T01:00:00Z');await sync('2026-10-27T01:00:10Z');
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_notification_incident_intents')).rows[0].n,381,'Due boundary reaches all381 QCs across bounded pages');
  const notice=(await db.pool.query('SELECT id FROM operations_notification_incident_intents LIMIT 1')).rows[0];
  await targets(2,4);
  assert.equal(await transaction(db.pool,c=>operationsNotificationRecipientAllowed(c,'operations-notice:'+notice.id,users.qc)),false,'Target mismatch hides pending rows before scan catches up');
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_notification_eligible_incident_intents')).rows[0].n,0);
  await sync('2026-10-27T01:00:20Z');await sync('2026-10-27T01:00:30Z');
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_notification_incidents')).rows[0].n,381,'Target edits never reset occurrence identity');
  const first=(await db.pool.query("SELECT snapshot FROM operations_board_versions WHERE site_id='benchmark-001' AND version=1")).rows[0].snapshot;
  const blocker={id:randomUUID(),stage:'UPS job completion',status:'open',reason:'Private fixture reason',raisedBy:'Fixture QC',actorId:users.qc,raisedAt:'2026-10-27T01:10:00Z'};
  await db.pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,2,$2,$3,$4,$5,$6)',['benchmark-001',{...first,blockers:[blocker]},'blocker','Fixture',randomUUID(),users.owner]);
  await sync('2026-10-27T01:10:00Z');await sync('2026-10-27T01:10:10Z');
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM operations_notification_incident_intents i JOIN operations_notification_incidents n ON n.id=i.incident_id WHERE n.site_id='benchmark-001'")).rows[0].n,4);
  await db.pool.query('UPDATE users SET active=false WHERE id=$1',[users.qc]);
  const oldQc=(await db.pool.query("SELECT i.id FROM operations_notification_incident_intents i JOIN operations_notification_incidents n ON n.id=i.incident_id WHERE n.site_id='benchmark-001' AND i.user_id=$1",[users.qc])).rows[0];
  assert.equal(await transaction(db.pool,c=>operationsNotificationRecipientAllowed(c,'operations-notice:'+oldQc.id,users.qc)),false);
  const changed=[await sync('2026-10-27T01:11:00Z'),await sync('2026-10-27T01:11:10Z')];
  assert.ok(changed.some(r=>r.held.some(h=>h.siteId==='benchmark-001'&&h.reasons.includes('Reviewed central-qc route is missing.'))));
  for(const table of ['stock_on_hand_entries','internal_purchase_orders','accounts_job_closures','notification_email_queue'])assert.equal((await db.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);
 }finally{await db.close();}
});
