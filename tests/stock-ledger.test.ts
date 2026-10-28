import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {materialStockFixture} from './material-stock-fixture.js';
import {MaterialStockRepository} from '../server/inventory/material-stock.js';
import {stockLedger} from '../server/inventory/stock-ledger.js';
test('stock drilldown reads historical totals, filters directions and enforces warehouse scope without posting',async()=>{
 const db=await testDatabase();try{
 const f=await materialStockFixture(db.pool);
 await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[f.reviewer,f.owner]);
 const stock=new MaterialStockRepository(db.pool);const overview=await stock.overview(f.reviewer);assert.deepEqual(Object.keys(overview.positions),['Lahore warehouse']);assert.deepEqual(overview.positions['Lahore warehouse'],(await stock.positions(f.reviewer,'Lahore warehouse')).positions);
 const before=await db.pool.query('SELECT count(*)::int n FROM inventory_warehouse_operational_movements');
 const all=await stockLedger(db.pool,f.reviewer,{warehouse:'Lahore warehouse',itemId:'FINAL',unit:'m'});
 assert.equal(all.total,2);assert.equal(all.events.reduce((n:number,e:any)=>n+Number(e.incoming),0),5);assert.equal(all.events.reduce((n:number,e:any)=>n+Number(e.outgoing),0),8);
 assert.equal((await stockLedger(db.pool,f.reviewer,{direction:'in'})).total,1);
 assert.equal((await stockLedger(db.pool,f.reviewer,{direction:'out'})).events[0].outgoing,'8');
 assert.equal((await stockLedger(db.pool,f.owner,{offset:100})).events.length,0);
 await assert.rejects(stockLedger(db.pool,f.reviewer,{warehouse:'Karachi warehouse'}),/outside your scope/);
 const outsider=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Other','Inventory','isolated')",[outsider,outsider+'@test.invalid']);
 await assert.rejects(stockLedger(db.pool,outsider,{}));
 assert.deepEqual((await db.pool.query('SELECT count(*)::int n FROM inventory_warehouse_operational_movements')).rows,before.rows);
 }finally{await db.close();}
});
