import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {NotificationsRepository} from '../server/notifications/repository.js';
test('paused stock notices preserve source/history, hide bell counts and cancel pending mail',async()=>{
 const db=await testDatabase();try{
 const actor=randomUUID(),alert=randomUUID(),notice=randomUUID();
 await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,'stock-pause@example.test','Owner','Management','isolated')",[actor]);
 await db.pool.query("UPDATE notification_settings SET email_enabled=true,activated_at=now()-interval '1 day'");
 await db.pool.query("INSERT INTO stock_watch_alerts(id,kind,user_id,reference,day) VALUES($1,'shortage',$2,'Preserved shortage evidence',current_date)",[alert,actor]);
 await db.pool.query("INSERT INTO notifications(id,user_id,source_key,entity_key,kind,title,reference,target,actionable,created_at) VALUES($1,$2,$3,'stock-watch:shortage','Stock shortage','Stock shortage','Preserved shortage evidence','{}',false,now())",[notice,actor,'stock-watch:'+alert]);
 const repo=new NotificationsRepository(db.pool),user={id:actor,role:'Management',email:'stock-pause@example.test',display_name:'Owner'} as any;
 assert.equal((await repo.list(user)).length,0);
 assert.equal((await repo.settings()).types.find(t=>t.kind==='Stock shortage').email_enabled,false);
 await db.pool.query('INSERT INTO notification_email_queue(id) VALUES($1)',[notice]);
 let sent=0;await repo.deliverOne({configured:true,send:async()=>{sent++;return 'unexpected';}},'http://localhost');assert.equal(sent,0);
 assert.equal((await db.pool.query('SELECT state FROM notification_email_queue WHERE id=$1',[notice])).rows[0].state,'cancelled');
 await repo.sync();await repo.sync();assert.equal((await db.pool.query('SELECT count(*)::int n FROM stock_watch_alerts')).rows[0].n,1);assert.equal((await db.pool.query("SELECT count(*)::int n FROM notifications WHERE kind='Stock shortage'")).rows[0].n,1);
 assert.equal((await db.pool.query("SELECT count(*)::int n FROM notification_email_queue WHERE state='queued'")).rows[0].n,0);
 }finally{await db.close();}
});
