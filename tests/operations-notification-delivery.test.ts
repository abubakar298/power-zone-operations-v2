import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {NotificationsRepository} from '../server/notifications/repository.js';
import type {User} from '../server/auth/repository.js';
import type {Message} from '../server/email/delivery.js';
test('Operations handoff projects once into captured mail and cancels revoked recipients without broadcasting or financial postings',async()=>{
 const db=await testDatabase();try{
  const owner=randomUUID(),accounts=randomUUID(),outsider=randomUUID();
  for(const [id,role]of [[owner,'Admin'],[accounts,'Accounts'],[outsider,'Accounts']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role,role,'isolated']);
  const start=new Date(Date.now()-60000).toISOString();
  await db.pool.query('UPDATE notification_settings SET email_enabled=true,activated_at=$1',[start]);
  await db.pool.query('INSERT INTO operations_notification_policy_versions(version,enabled,activated_at,reviewed_by,reason) VALUES(2,true,$1,$2,$3)',[start,owner,'Reviewed fictional activation']);
  await db.pool.query("INSERT INTO operations_notification_route_versions(audience,user_id,version,active,reviewed_by,reason) VALUES('accounts',$1,1,true,$2,'Reviewed fictional Accounts recipient')",[accounts,owner]);
  await db.pool.query("INSERT INTO operations_board_sites(id,created_by) VALUES('mail-fixture',$1)",[owner]);
  const event=async(version:number,kind:string)=>{
   await db.pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',['mail-fixture',version,{id:'mail-fixture',ipo:'FICTIONAL-IPO',name:'Fictional branch',operationsTeam:'central',privateCost:123456,blockerReason:'private free text'},kind,'Fictional notice',randomUUID(),owner]);
   await db.pool.query('INSERT INTO operations_board_events(id,site_id,site_version,kind,audiences,created_by) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),'mail-fixture',version,kind,JSON.stringify(['accounts']),owner]);
  };
  const repo=new NotificationsRepository(db.pool);await event(1,'Dispatch plan');await repo.sync();await repo.sync();
  const user={id:accounts,role:'Accounts'} as User,notices=await repo.list(user);assert.equal(notices.length,1);assert.equal(notices[0].target.target,'finance');assert.equal((await repo.list({id:outsider,role:'Accounts'} as User)).length,0);
  const sent:{message:Message;id:string}[]=[];const capture={configured:true,async send(message:Message,id:string){sent.push({message,id});return 'captured-'+id;}};
  await repo.deliverOne(capture,'https://app.example.test');await repo.deliverOne(capture,'https://app.example.test');assert.equal(sent.length,1);assert.equal(sent[0].message.to,accounts+'@example.test');assert.ok(!JSON.stringify(sent).includes('privateCost'));assert.ok(!JSON.stringify(sent).includes('private free text'));
  await event(2,'Installation completed');await repo.sync();
  await db.pool.query("INSERT INTO operations_notification_route_versions(audience,user_id,version,active,reviewed_by,reason) VALUES('accounts',$1,2,false,$2,'Revoke fictional routing')",[accounts,owner]);
  await repo.deliverOne(capture,'https://app.example.test');assert.equal(sent.length,1,'Revocation cannot send a queued message');
  await repo.sync();assert.equal((await repo.list(user)).length,0);
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM notification_email_queue WHERE state='queued'")).rows[0].n,0);
  for(const table of ['stock_on_hand_entries','internal_purchase_orders','accounts_job_closures'])assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n,0);
 }finally{await db.close();}
});
