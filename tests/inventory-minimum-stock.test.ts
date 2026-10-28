import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';import {materialStockFixture} from './material-stock-fixture.js';import {MinimumStockRepository} from '../server/inventory/minimum-stock.js';
test('minimum closing settings preserve warehouse/UOM scope, immutable versions, optimistic edits and idempotent retry without stock posting',async()=>{
 const db=await testDatabase();try{
  const f=await materialStockFixture(db.pool),repo=new MinimumStockRepository(db.pool),keeper=randomUUID(),outsider=randomUUID();
  for(const id of [keeper,outsider])await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'SIMULATION','Inventory','isolated')",[id,id+'@example.test']);
  for(const [id,warehouse,capability]of [[f.reviewer,'Lahore warehouse','dispatcher'],[keeper,'Lahore warehouse','storekeeper'],[outsider,'Karachi warehouse','dispatcher']])await db.pool.query('INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,$2,$3,$4)',[id,warehouse,capability,f.owner]);
  const stock=async()=>({movements:(await db.pool.query('SELECT count(*)::int n FROM inventory_warehouse_operational_movements')).rows[0].n,balances:(await db.pool.query("SELECT md5(string_agg(payload::text,'' ORDER BY ledger_key)) sha FROM inventory_warehouse_source_balances")).rows[0].sha});const before=await stock();
  assert.deepEqual((await repo.read(f.reviewer,'Lahore warehouse')).settings,[],'Unconfigured is distinct from a zero setting');
  const input={warehouse:'Lahore warehouse',itemId:'FINAL',unit:'m',minimum:'12.500',version:0,requestKey:randomUUID(),reason:'Reviewed local minimum closing setting'};
  const first=await repo.save(f.reviewer,input);assert.equal(first.minimum,'12.5');assert.equal(first.version,1);assert.equal(first.stockPosting,false);assert.deepEqual(await repo.save(f.reviewer,input),first);
  await assert.rejects(repo.save(f.reviewer,{...input,requestKey:randomUUID()}),/setting changed/);
  await assert.rejects(repo.save(f.reviewer,{...input,minimum:'13'}),/request key/);
  for(const uid of [keeper,outsider]){await assert.rejects(repo.read(uid,input.warehouse),/permission/);await assert.rejects(repo.save(uid,input),/permission/);}
  await assert.rejects(repo.save(f.reviewer,{...input,version:1,unit:'ft',requestKey:randomUUID()}),/exact item ID and unit/);
  await assert.rejects(repo.save(f.owner,{...input,warehouse:'Unknown warehouse',requestKey:randomUUID()}),/reviewed stock catalogue/);
  const second=await repo.save(f.owner,{...input,minimum:'0',version:1,requestKey:randomUUID(),reason:'Owner reviewed zero minimum'});assert.equal(second.version,2);assert.equal(second.minimum,'0');
  assert.equal((await repo.read(f.reviewer,input.warehouse)).settings[0].minimum,'0');assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_minimum_stock_versions')).rows[0].n,2);
  await assert.rejects(db.pool.query("UPDATE inventory_minimum_stock_versions SET minimum=1"),/immutable|cannot|not allowed/i);assert.deepEqual(await stock(),before);
  await db.pool.query('UPDATE users SET active=false WHERE id=$1',[f.reviewer]);await assert.rejects(repo.save(f.reviewer,{...input,version:2,requestKey:randomUUID()}),/access has ended/);
 }finally{await db.close();}
});
