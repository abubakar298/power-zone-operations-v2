import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import request from 'supertest';
import {testDatabase} from './database.js';
import {createDashboardSamples} from '../server/coordinator/samples.js';
import {OperationsRepository} from '../server/operations/repository.js';
import {DepartmentRepository} from '../server/departments/repository.js';
import {OrdersRepository} from '../server/orders/repository.js';
import {digest,hashPassword} from '../server/auth/crypto.js';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';

test('Department Inventory APIs require dispatcher capability; storekeepers cannot read BOQs or mutate queue progress',async()=>{
 const db=await testDatabase();
 try{
  const actors=Object.fromEntries(['admin','management','coordinator','dispatcher','keeper','unassigned','accounts'].map(k=>[k,randomUUID()]));
  const hash=await hashPassword('fictional-department-boundary-only-298');
  const roles:Record<string,string>={admin:'Admin',management:'Management',coordinator:'Coordinator',accounts:'Accounts'};
  for(const [name,id] of Object.entries(actors))await db.pool.query('INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',name,hash,roles[name]??'Inventory']);
  await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore','dispatcher',$3),($2,'Lahore','storekeeper',$3)",[actors.dispatcher,actors.keeper,actors.admin]);
  const samples=await createDashboardSamples(db.pool,actors.coordinator,actors.admin),source=samples.find((r:any)=>r.ipoId)!;
  const ops=new OperationsRepository(db.pool),repo=new DepartmentRepository(db.pool);
  const issued=await ops.issue(actors.coordinator,{ipoId:source.ipoId,notes:'Fictional department boundary',requestKey:randomUUID()});
  const plan=await ops.planDelivery(actors.admin,issued.id,{version:0,requestKey:randomUUID(),details:{deliveryAddress:'Fictional site',siteContact:'Fictional contact',sitePhone:'0300',deliveryDate:'2026-10-27',deliveryTime:'10:00',instructions:'Test only'}});
  const store=await ops.sendToStore(actors.admin,issued.id,plan.id,randomUUID());
  const input={id:store.id,version:0,stage:'Preparing stock' as const,notes:'Fictional preparation',requestKey:randomUUID()};
  const origin='http://localhost:3000',app=createApp(db.pool,readConfig({NODE_ENV:'test',DATABASE_URL:db.url,APP_ORIGIN:origin,ADMIN_SETUP_TOKEN:'department-boundary-test-setup-only-123'}));
  const sessions:Record<string,{cookie:string;csrf:string}>={};
  for(const [name,id] of Object.entries(actors)){const token=randomBytes(32).toString('base64url'),csrf=randomUUID();await db.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),id,csrf]);sessions[name]={cookie:'pz_session='+token,csrf};}
  const before=(await db.pool.query('SELECT id,snapshot FROM store_boq_issuances ORDER BY id')).rows;
  for(const name of ['keeper','unassigned']){
   await request(app).get('/api/departments/Inventory').set('Cookie',sessions[name].cookie).expect(403);
   await request(app).get('/api/departments/Inventory/'+store.id+'/history').set('Cookie',sessions[name].cookie).expect(403);
   await request(app).post('/api/departments/Inventory/checkpoints').set('Origin',origin).set('Cookie',sessions[name].cookie).set('X-CSRF-Token',sessions[name].csrf).send(input).expect(403);
   await assert.rejects(repo.checkpoint(actors[name],'Inventory',input),/dispatcher/);
  }
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM department_checkpoints')).rows[0].n,0);
  for(const name of ['admin','management','dispatcher'])await request(app).get('/api/departments/Inventory').set('Cookie',sessions[name].cookie).expect(200);
  await request(app).post('/api/departments/Inventory/checkpoints').set('Origin',origin).set('Cookie',sessions.dispatcher.cookie).send(input).expect(403);
  await request(app).post('/api/departments/Inventory/checkpoints').set('Origin',origin).set('Cookie',sessions.dispatcher.cookie).set('X-CSRF-Token',sessions.dispatcher.csrf).send(input).expect(201);
  await request(app).get('/api/departments/Inventory/'+store.id+'/history').set('Cookie',sessions.dispatcher.cookie).expect(200);
  const managementInput={...input,version:1,stage:'Ready for dispatch',requestKey:randomUUID()};
  await request(app).post('/api/departments/Inventory/checkpoints').set('Origin',origin).set('Cookie',sessions.management.cookie).set('X-CSRF-Token',sessions.management.csrf).send(managementInput).expect(201);
  await db.pool.query("DELETE FROM inventory_material_access WHERE user_id=$1 AND capability='dispatcher'",[actors.dispatcher]);
  await assert.rejects(repo.portal(actors.dispatcher,'Inventory'),/dispatcher/);
  await assert.rejects(repo.checkpoint(actors.dispatcher,'Inventory',{...input,version:2,stage:'Dispatched',requestKey:randomUUID()}),/dispatcher/);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM department_checkpoints')).rows[0].n,2);
  const orders=new OrdersRepository(db.pool);await orders.sendToAccounts(actors.admin,source.ipoId);
  await request(app).get('/api/departments/Accounts').set('Cookie',sessions.accounts.cookie).expect(200);
  await request(app).post('/api/departments/Accounts/checkpoints').set('Origin',origin).set('Cookie',sessions.accounts.cookie).set('X-CSRF-Token',sessions.accounts.csrf).send({...input,id:source.ipoId,stage:'Review in progress',requestKey:randomUUID()}).expect(201);
  await request(app).get('/api/departments/Inventory').set('Cookie',sessions.accounts.cookie).expect(403);
  assert.deepEqual((await db.pool.query('SELECT id,snapshot FROM store_boq_issuances ORDER BY id')).rows,before);
 }finally{await db.close();}
});
