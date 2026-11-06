import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import request from 'supertest';
import {testDatabase} from './database.js';
import {MastersRepository} from '../server/masters/repository.js';
import {hashPassword} from '../server/auth/crypto.js';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';

test('Coordinator can save and retrieve customer NTN/STRN text, with reason audit and stale-write protection',async()=>{
 const db=await testDatabase();try{
  const actor=randomUUID(),password='isolated-customer-tax-test-only';
  await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'Atif',$3,'Coordinator')",[actor,actor+'@example.test',await hashPassword(password)]);
  const origin='http://localhost:3000',app=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:origin,DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'isolated-customer-tax-setup-token'}));
  const login=await request(app).post('/api/auth/login').set('Origin',origin).send({email:actor+'@example.test',password}).expect(200),cookie=login.headers['set-cookie'][0].split(';')[0],csrf=login.body.csrfToken;
  const post=(body:any)=>request(app).post('/api/masters/customers').set('Origin',origin).set('Cookie',cookie).set('X-CSRF-Token',csrf).send(body);
  const values={name:'Tax Reference Customer',short_code:'TAX',contact_person:'Contact',phone:'',email:'',address:'Billing address',status:'Active',notes:'',ntn:'0801164-8',strn:'001234-00'};
  const created=(await post({id:'new',version:0,values}).expect(200)).body;
  const repo=new MastersRepository(db.pool),customer=(await repo.list()).customers.find((r:any)=>String(r.id)===String(created.id))!;
  assert.equal(customer.ntn,'0801164-8');assert.equal(customer.strn,'001234-00');
  const update={id:String(customer.id),version:customer.version,values:{...values,ntn:'0000123-4',strn:'',name:'Tax Reference Customer'}};
  await post(update).expect(400);
  await post({...update,changeReason:'Correct tax identity using customer confirmation'}).expect(200);
  const latest=(await repo.list()).customers.find((r:any)=>r.id===customer.id)!;
  assert.equal(latest.ntn,'0000123-4');assert.equal(latest.strn,'');
  await post({...update,changeReason:'Stale update'}).expect(409);
  const audit=(await db.pool.query("SELECT action FROM audit_log WHERE user_id=$1 AND action LIKE 'master.customer.changed:%'",[actor])).rows;
  assert.equal(audit.length,1);const detail=JSON.parse(audit[0].action.split('master.customer.changed:')[1]);assert.equal(detail.before.ntn,'0801164-8');assert.equal(detail.after.ntn,'0000123-4');assert.match(detail.reason,/customer confirmation/);
 }finally{await db.close();}
});
