import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import request from 'supertest';
import {testDatabase} from './database.js';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import {digest} from '../server/auth/crypto.js';

test('Management opens real department identity per request, keeps principal session and audits delegated attempts',async()=>{
 const db=await testDatabase();try{
 const origin='http://localhost:3000',app=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:origin,DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'isolated-department-view-setup-token'}));
 const ids:Record<string,string>={},cookies:Record<string,string>={},csrf:Record<string,string>={};
 for(const role of ['Management','Admin','Coordinator','Design','Accounts','Operations','Inventory','Employee']){
  const id=ids[role]=randomUUID(),token=randomBytes(32).toString('base64url');csrf[role]=randomUUID();cookies[role]='pz_session='+token;
  await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated',$4)",[id,id+'@example.test',role==='Coordinator'?'Atif Hameed':role,role]);
  await db.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),id,csrf[role]]);
 }
 const before=(await db.pool.query('SELECT count(*) FROM auth_sessions')).rows[0].count;
 const post=(path:string,role='Management')=>request(app).post(path).set('Origin',origin).set('Cookie',cookies[role]).set('X-CSRF-Token',csrf[role]);
 const list=await request(app).get('/api/auth/department-views').set('Cookie',cookies.Management).expect(200);
 assert.deepEqual(new Set(list.body.users.map((u:any)=>u.role)),new Set(['Coordinator','Design','Accounts','Operations','Inventory']));
 assert.equal(list.body.users.some((u:any)=>'password_hash' in u),false);
 await request(app).post('/api/auth/department-view').set('Origin',origin).set('Cookie',cookies.Management).send({userId:ids.Coordinator}).expect(403);
 const entered=await post('/api/auth/department-view').send({userId:ids.Coordinator}).expect(200);
 assert.equal(entered.body.user.id,ids.Coordinator);assert.equal(entered.headers['set-cookie'],undefined);
 for(const role of ['Coordinator','Design','Accounts','Operations','Inventory']){
  const r=await request(app).get('/api/dashboard').set('Cookie',cookies.Management).set('X-PZ-Department-User',ids[role]).set('X-PZ-Management-User',ids.Management).expect(200);
  assert.equal(r.body.user.id,ids[role]);assert.equal(r.body.user.role,role);
 }
 await request(app).get('/api/dashboard').set('Cookie',cookies.Accounts).set('X-PZ-Session-User',ids.Inventory).expect(409).expect(r=>assert.equal(r.body.code,'SESSION_CHANGED'));
 await request(app).post('/api/auth/logout').set('Origin',origin).set('Cookie',cookies.Accounts).set('X-CSRF-Token',csrf.Accounts).set('X-PZ-Session-User',ids.Inventory).send({}).expect(409);
 await request(app).get('/api/auth/session').set('Cookie',cookies.Accounts).expect(200).expect(r=>assert.equal(r.body.user.id,ids.Accounts));
 await request(app).get('/api/dashboard').set('Cookie',cookies.Management).set('X-PZ-Session-User',ids.Management).set('X-PZ-Department-User',ids.Coordinator).set('X-PZ-Management-User',ids.Management).expect(200).expect(r=>assert.equal(r.body.user.id,ids.Coordinator));
 const real=await request(app).get('/api/auth/session').set('Cookie',cookies.Management).set('X-PZ-Department-User',ids.Coordinator).set('X-PZ-Management-User',ids.Management).expect(200);
 assert.equal(real.body.user.id,ids.Management);assert.equal(real.body.csrfToken,csrf.Management);
 await request(app).get('/api/dashboard').set('Cookie',cookies.Management).expect(200).expect(r=>assert.equal(r.body.user.id,ids.Management));
 await request(app).get('/api/dashboard').set('Cookie',cookies.Coordinator).set('X-PZ-Department-User',ids.Management).set('X-PZ-Management-User',ids.Coordinator).expect(403);
 await request(app).get('/api/dashboard').set('Cookie',cookies.Management).set('X-PZ-Department-User',ids.Coordinator).set('X-PZ-Management-User',ids.Admin).expect(403);
 await request(app).get('/api/director/portfolio').set('Cookie',cookies.Management).set('X-PZ-Department-User',ids.Design).set('X-PZ-Management-User',ids.Management).expect(403);
 await request(app).post('/api/masters').set('Origin',origin).set('Cookie',cookies.Management).set('X-PZ-Department-User',ids.Design).set('X-PZ-Management-User',ids.Management).send({}).expect(403);
 await post('/api/masters').set('X-PZ-Department-User',ids.Design).set('X-PZ-Management-User',ids.Management).send({}).expect(403);
 const attempts=(await db.pool.query("SELECT user_id,action FROM audit_log WHERE action LIKE 'management.department-view:%'")).rows;
 assert.equal(attempts.filter(r=>JSON.parse(r.action.split('management.department-view:')[1]).kind==='request-attempt').length,1);
 assert.ok(attempts.every(r=>r.user_id===ids.Management));
 for(const role of ['Coordinator','Design','Accounts','Operations','Inventory','Employee'])await post('/api/auth/department-view',role).send({userId:ids.Coordinator}).expect(403);
 await post('/api/auth/department-view').send({userId:ids.Admin}).expect(403);
 await db.pool.query('UPDATE users SET active=false WHERE id=$1',[ids.Coordinator]);
 await request(app).get('/api/dashboard').set('Cookie',cookies.Management).set('X-PZ-Department-User',ids.Coordinator).set('X-PZ-Management-User',ids.Management).expect(403);
 await post('/api/auth/department-view').send({userId:null}).expect(200);
 assert.equal((await db.pool.query('SELECT count(*) FROM auth_sessions')).rows[0].count,before);
 }finally{await db.close();}
});
