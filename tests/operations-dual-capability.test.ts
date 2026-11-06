import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import request from 'supertest';
import {testDatabase} from './database.js';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import {digest} from '../server/auth/crypto.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';

test('explicit dual Procurement and Operations capabilities preserve both jobs without widening team or warehouse access',async()=>{
 const db=await testDatabase();
 try{
  const users:Record<string,string>={},cookies:Record<string,string>={};
  for(const key of ['owner','dual','buyer','board']){
   const id=users[key]=randomUUID(),token=randomBytes(32).toString('base64url');
   await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',key,key==='owner'?'Admin':'Operations','isolated-test']);
   await db.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),id,randomUUID()]);cookies[key]='pz_session='+token;
  }
  for(const key of ['dual','buyer'])await db.pool.query("INSERT INTO procurement_access(user_id,capability,granted_reason) VALUES($1,'buyer','Fictional dual-role test')",[users[key]]);
  for(const key of ['dual','board'])await db.pool.query("INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,'lead','central',$2)",[users[key],users.owner]);
  const repo=new OperationsBoardRepository(db.pool);
  await repo.importSource(users.owner,{sourceSha256:'d'.repeat(64),rows:[
   {id:'dual-central',ipo:'FICTIONAL-C',name:'Fictional Central',stage:'received',installation:true,operationsTeam:'central',documents:[]},
   {id:'dual-south',ipo:'FICTIONAL-S',name:'Fictional South',stage:'received',installation:true,operationsTeam:'south',documents:[]},
  ]});
  const origin='http://localhost:3000',app=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:origin,DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'isolated-dual-role-test-token-long-enough-20261027'}));
  const get=(key:string,path:string)=>request(app).get(path).set('Cookie',cookies[key]);
  for(const key of ['dual','buyer'])await get(key,'/api/procurement/requests').expect(200);
  await get('board','/api/procurement/requests').expect(403);
  await get('buyer','/api/operations-board/sites').expect(403);
  for(const key of ['dual','board']){
   const listed=await get(key,'/api/operations-board/sites').expect(200);
   assert.deepEqual(listed.body.sites.map((s:any)=>s.id),['dual-central']);
   await get(key,'/api/operations-board/sites/dual-south').expect(404);
   for(const path of ['/api/site-workflow','/api/site-workflow/report','/api/project-workflow/advance-inbox','/api/material-dispatches','/api/accounts-workspace','/api/masters'])await get(key,path).expect(403);
  }
  const me=await get('dual','/api/procurement/me').expect(200);assert.equal(me.body.buyer,true);assert.equal(me.body.operationsBoard,true);
  await db.pool.query('DELETE FROM operations_board_access WHERE user_id=$1',[users.dual]);
  await get('dual','/api/operations-board/sites').expect(403);
  await get('dual','/api/procurement/requests').expect(200);
 }finally{await db.close();}
});
