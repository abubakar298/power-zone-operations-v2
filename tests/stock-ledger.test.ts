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
 await db.pool.query(`INSERT INTO inventory_warehouse_source_events(source_sha256,event_id,payload) VALUES
 ($1,'historical-do',$2),($1,'shared-ipo-do',$3)`,[f.stockSha,
  {warehouse:'Lahore warehouse',itemId:'FINAL',unit:'m',out:1,ipo:'CHP-346',doNumber:'DO801-01'},
  {warehouse:'Lahore warehouse',itemId:'FINAL',unit:'m',out:1,ipo:'CHP-163(142/250)',doNumber:'DO794-01'}]);
 for(const [id,ipo,name] of [['lal-pull','CHP-346','Lal Pull, Lahore'],['choot','CHP-163 · 142/250','Choot Dheeran'],['other','CHP-163 · 143/250','Another site']]){
  await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[id,f.owner]);
  await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'import','Fixture',$3,$4)",[id,{ipo,name,customer:'United Bank Limited'},randomUUID(),f.owner]);
 }
 await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[f.reviewer,f.owner]);
 const stock=new MaterialStockRepository(db.pool);const overview=await stock.overview(f.reviewer);assert.deepEqual(Object.keys(overview.positions),['Lahore warehouse']);assert.deepEqual(overview.positions['Lahore warehouse'].map(position=>{assert.ok(position&&typeof position==='object'&&!Array.isArray(position));assert.ok('openingStatus' in position);const {openingStatus,...core}=position;assert.equal(openingStatus,'Reviewed source');return core;}),(await stock.positions(f.reviewer,'Lahore warehouse')).positions);
 const before=await db.pool.query('SELECT count(*)::int n FROM inventory_warehouse_operational_movements');
 const all=await stockLedger(db.pool,f.reviewer,{warehouse:'Lahore warehouse',itemId:'FINAL',unit:'m'});
 assert.equal(all.total,4);assert.equal(all.events.reduce((n:number,e:any)=>n+Number(e.incoming),0),5);assert.equal(all.events.reduce((n:number,e:any)=>n+Number(e.outgoing),0),10);
 assert.deepEqual(all.events.find((e:any)=>e.reference==='DO801-01').sites,[{siteName:'Lal Pull, Lahore',customer:'United Bank Limited'}]);
 assert.deepEqual(all.events.find((e:any)=>e.reference==='DO794-01').sites,[{siteName:'Choot Dheeran',customer:'United Bank Limited'}]);
 assert.equal((await stockLedger(db.pool,f.reviewer,{direction:'in'})).total,1);
 assert.ok((await stockLedger(db.pool,f.reviewer,{direction:'out'})).events.some((e:any)=>e.outgoing==='8'));
 assert.equal((await stockLedger(db.pool,f.owner,{offset:100})).events.length,0);
 await assert.rejects(stockLedger(db.pool,f.reviewer,{warehouse:'Karachi warehouse'}),/outside your scope/);
 const outsider=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Other','Inventory','isolated')",[outsider,outsider+'@test.invalid']);
 await assert.rejects(stockLedger(db.pool,outsider,{}));
 assert.deepEqual((await db.pool.query('SELECT count(*)::int n FROM inventory_warehouse_operational_movements')).rows,before.rows);
 }finally{await db.close();}
});
