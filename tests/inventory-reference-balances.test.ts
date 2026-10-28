import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {materialStockFixture} from './material-stock-fixture.js';
import {MaterialStockRepository} from '../server/inventory/material-stock.js';
import {MaterialDraftRepository} from '../server/inventory/material-drafts.js';
import {MinimumStockRepository} from '../server/inventory/minimum-stock.js';
import {lockWarehouseAuthority} from '../server/inventory/warehouse-access.js';
import {transaction} from '../server/db/transaction.js';
test('legacy imported balances remain visible as references without activating physical postings',async()=>{
 const db=await testDatabase();try{
  const f=await materialStockFixture(db.pool,'FINAL',{}),keeper=randomUUID();
  await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash)VALUES($1,$2,'Keeper','Inventory','no-login')",[keeper,keeper+'@example.test']);
  for(const [id,cap]of [[f.reviewer,'dispatcher'],[keeper,'storekeeper']])await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by)VALUES($1,'Lahore warehouse',$2,$3)",[id,cap,f.owner]);
  const repo=new MaterialStockRepository(db.pool),drafts=new MaterialDraftRepository(db.pool);
  assert.deepEqual((await drafts.warehouses(f.reviewer)).warehouses,['Lahore warehouse']);
  const result=await repo.positions(f.reviewer,'Lahore warehouse');assert.equal(result.authority,null);assert.equal(result.referenceOnly,true);assert.equal(result.positions.length,1);assert.equal(result.positions[0].currentClosing,'7');
  assert.deepEqual((await new MinimumStockRepository(db.pool).read(f.reviewer,'Lahore warehouse')).settings,[]);
  await assert.rejects(repo.positions(keeper,'Lahore warehouse'),/assigned Inventory dispatcher/);
  await assert.rejects(transaction(db.pool,c=>lockWarehouseAuthority(c,'Lahore warehouse',f.stockSha,1)),/activate/);
  for(const table of ['inventory_warehouse_authority_versions','inventory_warehouse_operational_movements'])assert.equal((await db.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);
 }finally{await db.close();}
});
