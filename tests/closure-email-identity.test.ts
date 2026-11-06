import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {NotificationsRepository} from '../server/notifications/repository.js';
import type {Message} from '../server/email/delivery.js';
import {closureEmailIdentity} from '../server/notifications/closure-identity.js';

test('Closure notification emails show exact submitted IPO, site, customer and config without internal keys or costs',async()=>{
 const db=await testDatabase();try{
  const actor=randomUUID(),manager=randomUUID(),report=randomUUID(),version=randomUUID(),closure=randomUUID();
  for(const [id,role] of [[actor,'Accounts'],[manager,'Management']])await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,'isolated')",[id,id+'@example.test',role,role]);
  await db.pool.query("UPDATE notification_settings SET activated_at=now()-interval '1 hour',email_enabled=true,reminders_enabled=false");
  await db.pool.query("INSERT INTO workflow_handoff_policy_versions(version,enabled,activated_at,reviewed_by,request_key,recipients,reason) VALUES(1,true,now()-interval '1 hour',$1,$2,$3,'Isolated notification test')",[manager,randomUUID(),JSON.stringify({management:[manager],accounts:[],inventory:[],leads:[],qc:[]})]);
  await db.pool.query('INSERT INTO inventory_reports(id,job_key,created_by) VALUES($1,$2,$3)',[report,'ubl:50',actor]);
  await db.pool.query("INSERT INTO inventory_report_versions(id,report_id,version,stage,snapshot,request_key,created_by) VALUES($1,$2,1,'Sent to Accounts','{}',$3,$4)",[version,report,randomUUID(),actor]);
  const snapshot={jobId:'CHP-320',title:'Adda Jahan Khan, Bhakkar',identity:{job_id:'CHP-320',site_name:'Adda Jahan Khan, Bhakkar',customer_code:'UBL',configuration_id:'35-30-40'},actualSecretCost:'PRIVATE_COST_MUST_NOT_APPEAR'};
  await db.pool.query("INSERT INTO accounts_job_closures(id,job_key,report_version_id,version,stage,snapshot,request_key,created_by) VALUES($1,$2,$3,1,'Awaiting Management',$4,$5,$6)",[closure,'ubl:50',version,snapshot,randomUUID(),actor]);
  const repo=new NotificationsRepository(db.pool);await repo.sync();
  const n=(await db.pool.query("SELECT id,reference FROM notifications WHERE kind=$1 AND user_id=$2",['Closure approval required',manager])).rows[0];assert.ok(n);assert.equal(n.reference,'ubl:50');
  await db.pool.query("UPDATE notification_email_queue SET next_attempt_at=now()+interval '1 day' WHERE id<>$1",[n.id]);
  let message:Message|undefined;
  await repo.deliverOne({configured:true,send:async m=>{message=m;return 'captured-only';}},'https://example.test');
  assert.ok(message);for(const value of ['IPO: CHP-320','Site: Adda Jahan Khan, Bhakkar','Customer:','Site config: 35-30-40']){assert.ok(message.text.includes(value),value);assert.ok(message.html!.includes(value),value);}
  assert.ok(message.subject.includes('CHP-320'));assert.ok(message.subject.includes('Adda Jahan Khan, Bhakkar'));assert.ok(message.subject.includes('35-30-40'));
  assert.ok(!JSON.stringify(message).includes('ubl:50'));assert.ok(!JSON.stringify(message).includes('PRIVATE_COST_MUST_NOT_APPEAR'));
  const c=await db.pool.connect();try{
   await assert.rejects(closureEmailIdentity(c,{event_source_key:`handoff:closure:${closure}:${manager}`,event_kind:'Closure approval required',audience:'management',role:'Coordinator'}),/not authorised/);
   await assert.rejects(closureEmailIdentity(c,{event_source_key:'unrelated:ubl:50',event_kind:'Closure approval required',audience:'management',role:'Management'}),/source/);
   assert.equal(await closureEmailIdentity(c,{event_source_key:'other',event_kind:'Submitted',audience:'management',role:'Management'}),null);
  }finally{c.release();}
 }finally{await db.close();}
});
