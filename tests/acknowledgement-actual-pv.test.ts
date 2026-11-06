import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {materialStockFixture} from './material-stock-fixture.js';
import {warehouseLedgerKey} from '../server/inventory/warehouse-source.js';
import {MaterialStockRepository} from '../server/inventory/material-stock.js';
test('downloading an earlier site DO refreshes PV acknowledgment from later scoped partial DOs without posting stock',async()=>{
 const db=await testDatabase();try{
 const itemId='CH-Solar Plates',baseline=(warehouse:string)=>({itemId,warehouse,unit:'Watt',description:'Solar PV Modules',opening:100000,in:0,out:0,closing:100000,openingStatus:'Reviewed',review:''});
 const f=await materialStockFixture(db.pool,'CH-CBL-AC-16MM/4C-PK',{},[baseline('Lahore warehouse')]),siteId=randomUUID(),stock=new MaterialStockRepository(db.pool);
 await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[f.reviewer,f.owner]);
 async function dispatch(number:string,quantity:string|null,warehouse='Lahore warehouse'){
 const id=randomUUID(),draft=randomUUID(),lineKey=randomUUID(),snapshot={kind:'fixed',parent:false,warehouse,status:'issued',stockPosting:false,sites:[{siteId,siteName:'Partial PV test',ipo:'IPO-TEST',customer:'UBL',installation:true}],lines:quantity?[{key:lineKey,itemId,description:'Solar PV Modules',out:quantity,unit:'Watt',sites:[siteId]}]:[],transport:{issuedTo:'Team',vehicle:'TEST',driver:'Driver',driverIdentity:''}};
 await db.pool.query('INSERT INTO inventory_material_drafts(id,created_by) VALUES($1,$2)',[draft,f.owner]);await db.pool.query('INSERT INTO inventory_material_draft_versions(draft_id,version,snapshot,request_key,request_fingerprint,created_by) VALUES($1,1,$2,$3,$4,$5)',[draft,snapshot,randomUUID(),'a'.repeat(64),f.owner]);
 await db.pool.query('INSERT INTO inventory_material_dispatches(id,number,draft_id,draft_version,source_sha256,warehouse,snapshot,request_key,request_fingerprint,created_by) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9)',[id,number,draft,f.stockSha,warehouse,snapshot,randomUUID(),'b'.repeat(64),f.owner]);
 if(quantity)await db.pool.query('INSERT INTO inventory_material_dispatch_lines(dispatch_id,line_key,source_sha256,ledger_key,item_id,unit,description,quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,lineKey,f.stockSha,warehouseLedgerKey(itemId,warehouse,'Watt'),itemId,'Watt','Solar PV Modules',quantity]);return id;
 }
 const first=await dispatch('DO-BESS-FIRST',null);assert.equal((await stock.acknowledgements(f.reviewer,first))[0].panels,'');
 await dispatch('DO-SOLAR-PARTIAL','12900');assert.equal((await stock.acknowledgements(f.reviewer,first))[0].panels,'12,900 W of Solar Panels');
 await dispatch('DO-SOLAR-BALANCE','12255');assert.equal((await stock.acknowledgements(f.reviewer,first))[0].panels,'25,155 W of Solar Panels');
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_warehouse_operational_movements')).rows[0].n,0);
 }finally{await db.close();}
});
