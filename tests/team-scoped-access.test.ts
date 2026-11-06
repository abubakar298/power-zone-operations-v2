import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {AccountsService} from '../server/onboarding/service.js';
import {AccountsRepository} from '../server/onboarding/repository.js';
import {teamAccessProfileSchema,teamProfileRole} from '../shared/team-access-profile.js';
test('Team scoped profiles require exact region/warehouse scope and never accept expanded duties',()=>{
 for(const kind of ['QC','Operations Lead'])assert.equal(teamProfileRole(teamAccessProfileSchema.parse({kind,region:'central'})),'Operations');
 assert.equal(teamProfileRole(teamAccessProfileSchema.parse({kind:'Storekeeper',warehouses:['Lahore']})),'Inventory');
 for(const bad of [{kind:'QC'},{kind:'QC',region:'all'},{kind:'QC',region:'south',procurement:['buyer']},{kind:'Operations Lead',region:'south',warehouses:['Lahore']},{kind:'Storekeeper',warehouses:[]},{kind:'Storekeeper',warehouses:['*']},{kind:'Storekeeper',warehouses:['Lahore','Lahore']},{kind:'Storekeeper',warehouses:['Lahore'],capability:'dispatcher'}])assert.equal(teamAccessProfileSchema.safeParse(bad).success,false);
});
test('scoped invitations fail explicitly before delivery instead of silently dropping assignments',async()=>{
 const service=new AccountsService(null as any,null as any,null as any,null as any);
 await assert.rejects(service.invite({email:'qc@example.invalid',role:'Operations',scopedAccess:{kind:'QC',region:'central'}},{} as any,'isolated'),/Ordinary invitations do not retain scoped profiles/);
});
test('direct scoped accounts commit exact grants atomically, retain unverified state and reject unknown warehouses',async()=>{
 const db=await testDatabase();try{
  const admin=randomUUID(),hash='fixture-not-a-login-hash';
  await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,'scoped-admin@example.invalid','Scoped Admin','Admin',$2)",[admin,hash]);
  await db.pool.query('INSERT INTO inventory_warehouse_sources(source_sha256,catalogue_sha256,metadata,content_fingerprint,created_by) VALUES($1,$2,$3,$4,$5)',['a'.repeat(64),'b'.repeat(64),{},'c'.repeat(64),admin]);
  await db.pool.query('INSERT INTO inventory_warehouse_source_balances(source_sha256,ledger_key,payload) VALUES($1,$2,$3)',['a'.repeat(64),'d'.repeat(64),{warehouse:'Fixture Lahore'}]);
  const repo=new AccountsRepository(db.pool),base={displayName:'Fixture staff',passwordHash:hash,actorId:admin,actorHash:hash};
  const qc=await repo.createDirect({...base,email:'qc@example.invalid',role:'Operations',scopedAccess:{kind:'QC',region:'south'}});
  assert.deepEqual((await db.pool.query('SELECT kind,team FROM operations_board_access WHERE user_id=$1',[qc.id])).rows,[{kind:'qc',team:'south'}]);
  const lead=await repo.createDirect({...base,email:'lead@example.invalid',role:'Operations',scopedAccess:{kind:'Operations Lead',region:'central'}});
  assert.deepEqual((await db.pool.query('SELECT kind,team FROM operations_board_access WHERE user_id=$1',[lead.id])).rows,[{kind:'lead',team:'central'}]);
  const store=await repo.createDirect({...base,email:'store@example.invalid',role:'Inventory',scopedAccess:{kind:'Storekeeper',warehouses:['Fixture Lahore']}});
  assert.deepEqual((await db.pool.query('SELECT warehouse,capability FROM inventory_material_access WHERE user_id=$1',[store.id])).rows,[{warehouse:'Fixture Lahore',capability:'storekeeper'}]);
  const listed=await repo.list();assert.equal(listed.users.find(u=>u.id===qc.id)?.operations_access.kind,'qc');assert.equal(listed.users.find(u=>u.id===store.id)?.warehouse_access[0].capability,'storekeeper');
  for(const id of [qc.id,lead.id,store.id]){
   assert.equal((await db.pool.query('SELECT email_verified_at FROM users WHERE id=$1',[id])).rows[0].email_verified_at,null);
   assert.equal((await db.pool.query('SELECT count(*)::int n FROM procurement_access WHERE user_id=$1',[id])).rows[0].n,0);
   assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_review_access WHERE user_id=$1',[id])).rows[0].n,0);
  }
  await assert.rejects(repo.createDirect({...base,email:'unknown@example.invalid',role:'Inventory',scopedAccess:{kind:'Storekeeper',warehouses:['Unknown warehouse']}}),/current warehouse register/);
  await assert.rejects(repo.createDirect({...base,email:'mismatch@example.invalid',role:'Admin',scopedAccess:{kind:'QC',region:'central'}}),/base role/);
  await assert.rejects(repo.createDirect({...base,email:'wrong-admin@example.invalid',role:'Operations',actorHash:'changed',scopedAccess:{kind:'QC',region:'central'}}),/account access changed/);
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM users WHERE email IN('unknown@example.invalid','mismatch@example.invalid','wrong-admin@example.invalid')")).rows[0].n,0);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM account_tokens')).rows[0].n,0);
 }finally{await db.close();}
});
