import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {materialStockFixture} from './material-stock-fixture.js';
import {MaterialDraftRepository} from '../server/inventory/material-drafts.js';
test('storekeepers create temporary documents only in their warehouse without gaining dispatch rights or changing stock',async()=>{
 const db=await testDatabase();try{
  const f=await materialStockFixture(db.pool),repo=new MaterialDraftRepository(db.pool),keeper=randomUUID(),other=randomUUID();
  for(const [id,warehouse]of [[keeper,'Lahore warehouse'],[other,'Karachi warehouse']]){await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash)VALUES($1,$2,$3,$4,$5)',[id,id+'@keeper.example.test','Keeper','Inventory','isolated']);await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by)VALUES($1,$2,'storekeeper',$3)",[id,warehouse,f.owner]);}
  const before=(await db.pool.query('SELECT source_sha256,ledger_key,payload FROM inventory_warehouse_source_balances ORDER BY source_sha256,ledger_key')).rows;
  const input={requestKey:randomUUID(),id:'',version:0,type:'OGP',date:'2026-10-29',warehouse:'Lahore warehouse',party:'Fictional party',sourceReference:'',actualReference:'',notes:'Isolated temporary record',detailsConfirmed:false,lines:[{itemId:'FINAL',description:'Fixture item',quantity:'1',unit:'piece',remarks:''}]};
  const saved=await repo.saveTemporaryDocument(keeper,input);assert.match(saved.number,/^TMP-OGP-/);assert.deepEqual(await repo.saveTemporaryDocument(keeper,input),saved);
  assert.deepEqual((await repo.temporaryDocuments(keeper)).warehouses,['Lahore warehouse']);assert.equal((await repo.temporaryDocuments(other)).documents.length,0);
  await assert.rejects(repo.saveTemporaryDocument(keeper,{...input,requestKey:randomUUID(),warehouse:'Karachi warehouse'}),/outside/);
  await assert.rejects(repo.saveTemporaryDocument(other,{...input,id:saved.id,version:1,requestKey:randomUUID(),warehouse:'Karachi warehouse'}),/outside/);
  await assert.rejects(repo.intake(keeper),/not assigned/);await assert.rejects(repo.list(keeper),/not assigned/);
  assert.deepEqual((await db.pool.query('SELECT source_sha256,ledger_key,payload FROM inventory_warehouse_source_balances ORDER BY source_sha256,ledger_key')).rows,before);assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_warehouse_operational_movements')).rows[0].n,0);
 }finally{await db.close();}
});
