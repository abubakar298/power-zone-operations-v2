import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import request from 'supertest';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import {digest} from '../server/auth/crypto.js';
import {testDatabase} from './database.js';
import {AccountsSourceRegisters,type AccountsSource} from '../server/accounts/source-registers.js';

test('Accounts source imports preserve immutable evidence, role boundaries, exactly-once identity and financial tables',async()=>{
 const db=await testDatabase();try{
  const roles=['Admin','Accounts','Inventory','Operations'] as const,users:Record<string,string>={};
  for(const role of roles){const id=users[role]=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);}
  const source:AccountsSource={sourceDate:'2026-10-26',manifest:[{name:'safe-test-source',sha256:'a'.repeat(64)}],registers:[{rows:[{kind:'UPS',customer:'UBL',key:'safe-site',ipo:'IPO-test',site:'Local example',invoiceReferences:['26-10001'],invoiceAmount:'100.00',singleInvoiceSubmitted:true}]}],cables:{rows:[]},internet:{rows:[]},sites:{rows:[{key:'safe-site',site:'Local example',position:'delivered'}]},evidence:{rows:[{customer:'United Bank Limited',invoice:'26-10001',status:'submitted',balance:'50.00',date:'2026-10-01'}],cableStageAdjustments:[]}};
  const repo=new AccountsSourceRegisters(db.pool);
  await assert.rejects(repo.billing(users.Accounts),/not been imported/);
  await assert.rejects(repo.import(users.Accounts,source,0),/Administrator/);
  const saved=await repo.import(users.Admin,source,0);
  assert.equal(saved.version,1);assert.equal((await repo.import(users.Admin,source,0)).id,saved.id);
  const result=await repo.billing(users.Accounts,new Date('2026-10-26T21:00:00Z'));
  assert.equal(result.asOf,'2026-10-27');assert.equal(result.sourceAsOf,'2026-10-26');
  assert.equal(result.rows[0].pending,'50.00');assert.equal(result.customers[0].submittedPending,'50.00');assert.equal(result.readOnlySource,true);
  assert.equal((await repo.sites(users.Accounts)).rows[0].position,'delivered');
  for(const role of ['Inventory','Operations'])await assert.rejects(repo.billing(users[role]),/Accounts access/);
  await assert.rejects(repo.import(users.Admin,{...source,sourceDate:'2026-10-27'},0),/source register changed/);
  assert.equal((await db.pool.query('SELECT count(*)::int AS count FROM accounts_source_registers')).rows[0].count,1);
  await assert.rejects(db.pool.query("UPDATE accounts_source_registers SET source_date='2026-10-27' WHERE id=$1",[saved.id]));
  for(const table of ['internal_purchase_orders','accounts_job_closures','stock_on_hand_entries'])assert.equal((await db.pool.query('SELECT count(*)::int AS count FROM '+table)).rows[0].count,0);
  // Exercise the real session, route and permission layers as well as repository guards.
  const origin='http://localhost:3000',app=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:origin,DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'source-register-isolated-setup-token'}));
  await request(app).get('/api/accounts-workspace/billing').expect(401);
  for(const role of roles){
   const token=randomBytes(32).toString('base64url'),csrf=randomUUID();
   await db.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),users[role],csrf]);
   for(const path of ['billing','sites']){
    const response=await request(app).get('/api/accounts-workspace/'+path).set('Cookie','pz_session='+token);
    assert.equal(response.status,['Admin','Accounts'].includes(role)?200:403,role+' '+path);
    if(response.status===200)assert.match(response.headers['cache-control'],/no-store/);
   }
   await request(app).post('/api/accounts-workspace/pt-entries').set('Cookie','pz_session='+token).set('Origin',origin).send({}).expect(403);
  }
 }finally{await db.close();}
});
