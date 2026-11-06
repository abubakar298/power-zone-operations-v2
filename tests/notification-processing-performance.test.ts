import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {testDatabase} from './database.js';import {NotificationsRepository} from '../server/notifications/repository.js';
test('unchanged projection avoids duplicate insert attempts, evaluates resolution once, preserves notices/read state/mail and business history',async()=>{
 const db=await testDatabase();try{
 const users={designer:randomUUID(),owner:randomUUID(),manager:randomUUID()};for(const [key,id] of Object.entries(users))await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',key,key==='designer'?'Design':key==='owner'?'Coordinator':'Admin','isolated']);
 await db.pool.query("UPDATE notification_settings SET activated_at=now()-interval '200 hours',email_enabled=true,reminders_enabled=true,reminder_hours=4");
 await db.pool.query("INSERT INTO audit_log(user_id,target_user_id,action,created_at) SELECT $1,$2,'account.activated',now()-interval '1 hour' FROM generate_series(1,240)",[users.manager,users.owner]);
 const draft=randomUUID(),survey=randomUUID();await db.pool.query('INSERT INTO survey_drafts(id,owner_id,inputs) VALUES($1,$2,$3)',[draft,users.owner,{siteName:'Isolated performance fixture'}]);await db.pool.query('INSERT INTO design_surveys(id,owner_id,inputs) VALUES($1,$2,$3)',[survey,users.designer,{siteName:'Isolated performance fixture'}]);await db.pool.query("INSERT INTO design_survey_handoffs(id,survey_id,form_version,draft_id,assigned_to,created_by,inputs,created_at) VALUES($1,$2,1,$3,$4,$5,$6,now()-interval '100 hours')",[randomUUID(),survey,draft,users.owner,users.designer,{siteName:'Isolated performance fixture'}]);
 const repo=new NotificationsRepository(db.pool);await repo.sync();const first=(await db.pool.query("SELECT id FROM notifications WHERE user_id=$1 ORDER BY created_at LIMIT 1",[users.owner])).rows[0].id;await repo.read({id:users.owner} as any,first);
 const notices=async()=>(await db.pool.query('SELECT row_to_json(n)::text row FROM notifications n ORDER BY id')).rows;const queue=async()=>(await db.pool.query('SELECT row_to_json(q)::text row FROM notification_email_queue q ORDER BY id')).rows;
 const baseline=await notices(),mail=await queue(),business=(await db.pool.query('SELECT row_to_json(a)::text row FROM audit_log a ORDER BY id')).rows;
 await db.pool.query("CREATE TABLE notification_attempt_probe(kind text NOT NULL); CREATE FUNCTION record_notification_attempt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO notification_attempt_probe(kind) VALUES(TG_TABLE_NAME);RETURN NEW;END$$;CREATE TRIGGER notice_attempt BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION record_notification_attempt();CREATE TRIGGER queue_attempt BEFORE INSERT ON notification_email_queue FOR EACH ROW EXECUTE FUNCTION record_notification_attempt()");
 const queries:string[]=[];const measuredPool={connect:async()=>{const c=await db.pool.connect();return {query:(sql:any,...args:any[])=>{queries.push(typeof sql==='string'?sql:sql.text);return (c.query as any)(sql,...args);},release:()=>c.release()};}};
 const measured=new NotificationsRepository(measuredPool as any);const start=performance.now();await measured.sync();const elapsed=performance.now()-start;
 assert.deepEqual(await notices(),baseline);assert.deepEqual(await queue(),mail);assert.deepEqual((await db.pool.query('SELECT * FROM notification_attempt_probe')).rows,[]);assert.deepEqual((await db.pool.query('SELECT row_to_json(a)::text row FROM audit_log a ORDER BY id')).rows,business);
 assert.equal(queries.filter(q=>q.includes('FROM notification_events')).length,1);assert.equal(queries.filter(q=>q.includes('WITH current_events AS MATERIALIZED')).length,1);assert.equal((await db.pool.query("SELECT count(*)::int n FROM notifications WHERE read_at IS NOT NULL")).rows[0].n,1);
 assert.ok(baseline.length>=243);assert.equal((await db.pool.query("SELECT count(*)::int n FROM notifications WHERE kind IN('Reminder','Escalation')")).rows[0].n,2);
 console.log(JSON.stringify({fixtureEvents:241,notices:baseline.length,unchangedSyncMs:Number(elapsed.toFixed(2)),duplicateInsertAttempts:0,fullEventViewScans:1,basis:'Disposable native PostgreSQL only; not production latency'}));
 // New work is still projected once; historical acknowledgements and queued mail remain.
 await db.pool.query("INSERT INTO audit_log(user_id,target_user_id,action) VALUES($1,$2,'account.activated')",[users.manager,users.owner]);await measured.sync();const after=await notices();assert.equal(after.length,baseline.length+1);assert.equal((await db.pool.query("SELECT count(*)::int n FROM notifications WHERE read_at IS NOT NULL")).rows[0].n,1);assert.equal((await db.pool.query("SELECT count(*)::int n FROM notification_attempt_probe WHERE kind='notifications'")).rows[0].n,1);
 for(const t of ['internal_purchase_orders','stock_on_hand_entries','accounts_job_closures'])assert.equal((await db.pool.query('SELECT count(*)::int n FROM '+t)).rows[0].n,0);
 }finally{await db.close();}
});
test('a concurrent projection skips without waiting, then processes new work exactly once after the current worker releases',async()=>{
 const db=await testDatabase();try{
 const actor=randomUUID(),owner=randomUUID();for(const [id,role] of [[actor,'Admin'],[owner,'Accounts']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);
 await db.pool.query("UPDATE notification_settings SET activated_at=now()-interval '1 hour'");await db.pool.query("INSERT INTO audit_log(user_id,target_user_id,action) VALUES($1,$2,'account.activated')",[actor,owner]);
 const current=await db.pool.connect();await current.query('BEGIN');await current.query('SELECT pg_advisory_xact_lock(742019032)');const repo=new NotificationsRepository(db.pool);
 try{const start=performance.now();await repo.sync();assert.ok(performance.now()-start<2000,'A duplicate sweep must skip rather than wait for the held projector lock');assert.equal((await db.pool.query('SELECT count(*)::int n FROM notifications')).rows[0].n,0);}finally{await current.query('ROLLBACK');current.release();}
 await repo.sync();await repo.sync();assert.equal((await db.pool.query('SELECT count(*)::int n FROM notifications WHERE user_id=$1',[owner])).rows[0].n,1);assert.equal((await db.pool.query("SELECT count(*)::int n FROM audit_log WHERE action='account.activated'")).rows[0].n,1);
 }finally{await db.close();}
});

test('empty inboxes and empty email queues avoid the live notification source view',async()=>{
 const db=await testDatabase();try{
 const id=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'isolated','Accounts','isolated')",[id,id+'@example.test']);
 const queries:string[]=[];const measured={query:(sql:any,...args:any[])=>{queries.push(String(sql));return(db.pool.query as any)(sql,...args);},connect:async()=>{const c=await db.pool.connect();return{query:(sql:any,...args:any[])=>{queries.push(String(sql));return(c.query as any)(sql,...args);},release:()=>c.release()};}};
 const repo=new NotificationsRepository(measured as any);assert.deepEqual(await repo.list({id,role:'Accounts'} as any),[]);
 await repo.deliverOne({configured:true,send:async()=>{throw Error('No message should be sent');}},'https://example.test');
 assert.equal(queries.filter(q=>q.includes('notification_events')).length,0);
 }finally{await db.close();}
});
