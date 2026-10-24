import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,copyFile,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {testDatabase} from './database.js';
import {migrate} from '../server/db/migrate.js';
import {preservationSnapshot,requirePreserved} from '../server/db/preservation.js';
import {MastersRepository} from '../server/masters/repository.js';
import {selectCatalogueItem} from '../server/masters/catalogue.js';

test('final stock ID release preserves recorded business, pricing and current wording; colour aliases never guess',async()=>{
 const db=await testDatabase({skipMigrations:true});const pre=await mkdtemp(join(tmpdir(),'pz-pre-final-ids-'));
 try{
  for(const name of await readdir('migrations'))if(/^\d+_.*\.sql$/.test(name)&&name!=='107_final_stock_item_ids.sql')await copyFile(join('migrations',name),join(pre,name));
  await migrate(db.pool,pre);
  // Commercial wording may have changed since the local mapping was approved.
  await db.pool.query(`INSERT INTO inventory_catalogue_versions(item_id,version,payload,rate_key) SELECT item_id,version+1,payload||'{"commercialDescription":"Current live wording retained"}'::jsonb,rate_key FROM inventory_catalogue_current WHERE item_id='CH-11 WAY-DB'`);
  const c=await db.pool.connect();let before;try{before=await preservationSnapshot(c);}finally{c.release();}
  const old=(await db.pool.query("SELECT * FROM inventory_catalogue_current WHERE item_id='CH-11 WAY-DB'")).rows[0];
  await migrate(db.pool,undefined,true);
  const afterClient=await db.pool.connect();try{requirePreserved(before,await preservationSnapshot(afterClient,false,before),'final IDs verification');}finally{afterClient.release();}
  const m=await new MastersRepository(db.pool).list();
  assert.equal(m.catalogue.length,199);assert.equal(m.catalogue.filter(i=>i.payload.finalStockId).length,159);
  assert.equal(new Set(m.catalogue.map(i=>i.item_id)).size,m.catalogue.length);
  const box=m.catalogue.find(i=>i.item_id==='CH-11WAY-DB')!;
  assert.equal(box.payload.commercialDescription,'Current live wording retained');assert.equal(box.rate_key,old.rate_key);assert.equal(box.payload.unit,old.payload.unit);assert.deepEqual(box.payload.stockUnits,['piece']);
  assert(!m.catalogue.some(i=>i.item_id==='CH-11 WAY-DB'));
  assert(m.itemAliases.some(a=>a.alias==='CH-11 WAY-DB'&&a.item_id==='CH-11WAY-DB'));
  assert(!m.itemAliases.some(a=>a.alias==='CH-Cable-DC-6MM'),'combined cable cannot resolve to an arbitrary colour');
  assert.equal(selectCatalogueItem(m,'6mm² DC Cable Red','Pakistan Cables')?.item_id,'CH-CBL-DC-6MM/1C-R/PK');
  assert.equal(selectCatalogueItem(m,'6mm² DC Cable Black','Pakistan Cables')?.item_id,'CH-CBL-DC-6MM/1C-B/PK');
  const local=m.catalogue.find(i=>i.item_id==='CH-CBL-DC-6MM/1C-R/LCL')!;
  assert.equal(local.rate_key,null);assert.equal(local.payload.rateLinkPending,true);
  assert.equal(selectCatalogueItem(m,'6mm² DC Cable Red','All other cables')?.item_id,'CH-CBL-DC-6MM/1C-RB-AOB');
  assert.deepEqual(await new MastersRepository(db.pool).history('rates','CH-11WAY-DB'),await new MastersRepository(db.pool).history('rates','CH-11 WAY-DB'));
  const count=(await db.pool.query('SELECT count(*) FROM inventory_catalogue_versions')).rows[0].count;
  await migrate(db.pool,undefined,true);assert.equal((await db.pool.query('SELECT count(*) FROM inventory_catalogue_versions')).rows[0].count,count);
  await assert.rejects(db.pool.query("UPDATE inventory_final_stock_ids SET description='bad'"),/immutable/);
  const sql=await readFile('migrations/107_final_stock_item_ids.sql','utf8');assert(!/INSERT INTO (inventory_catalogue_versions|rate_versions|inventory_item_aliases|inventory_reports|inventory_movements)/i.test(sql));
 }finally{await db.close();await rm(pre,{recursive:true,force:true});}
});
