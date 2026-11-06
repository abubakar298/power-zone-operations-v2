import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {testDatabase} from './database.js';
import {migrate} from '../server/db/migrate.js';
import {fixedPreparationRows} from '../shared/material-preparation.js';
import {MaterialDraftRepository} from '../server/inventory/material-drafts.js';
import {randomUUID} from 'node:crypto';

test('VPD mapping resolves approved references without changing stored stock or business rows',async()=>{
 const db=await testDatabase({skipMigrations:true}),pre=await mkdtemp(join(tmpdir(),'pz-pre-vpd-'));
 try{
  for(const name of await readdir('migrations'))if(/^\d+_.*\.sql$/.test(name)&&name!=='144_vpd_final_stock_alias.sql')await copyFile(join('migrations',name),join(pre,name));
  await migrate(db.pool,pre);
  const actor=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[actor,'vpd@example.test','VPD fixture','Admin','isolated']);
  await db.pool.query("INSERT INTO stock_on_hand_entries(item_key,kind,quantity,unit,note,created_by) VALUES('63A 1P AC VPD','count',52,'Each','Isolated VPD preservation fixture',$1)",[actor]);
  await db.pool.query("INSERT INTO inventory_warehouse_sources(source_sha256,catalogue_sha256,metadata,content_fingerprint,created_by) VALUES($1,$2,'{}',$3,$4)",['a'.repeat(64),'b'.repeat(64),'c'.repeat(64),actor]);
  await db.pool.query("INSERT INTO inventory_warehouse_source_balances(source_sha256,ledger_key,payload) VALUES($1,$2,$3)",['a'.repeat(64),'d'.repeat(64),{itemId:'CH-VPD-63A/2P',warehouse:'Karachi warehouse',unit:'piece',opening:0,in:52,out:0,closing:52}]);
  const repo=new MaterialDraftRepository(db.pool),old=await repo.intake(actor);
  assert.equal(old.aliases['63A 1P AC VPD'],undefined);
  const tables=(await db.pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('schema_migrations','inventory_final_stock_aliases') ORDER BY tablename")).rows.map(r=>r.tablename);
  async function snapshot(){const result:Record<string,unknown>={};for(const t of tables)result[t]=(await db.pool.query(`SELECT count(*)::text AS count,md5(coalesce(string_agg(h,'' ORDER BY h),'')) AS digest FROM (SELECT md5(to_jsonb(t)::text) h FROM "${t}" t) q`)).rows[0];return result;}
  const oldCommercial=(await db.pool.query("SELECT rate_key,payload FROM inventory_catalogue_final_current WHERE item_id='CH-VPD-2P'")).rows[0];
  const before=await snapshot();await migrate(db.pool,undefined,true);assert.deepEqual(await snapshot(),before);
  const current=await repo.intake(actor);
  const mapped=(await db.pool.query("SELECT rate_key,payload FROM inventory_catalogue_final_current WHERE item_id='CH-VPD-63A/2P'")).rows[0];assert.equal(mapped.rate_key,oldCommercial.rate_key);assert.equal(mapped.payload.technicalDescription,oldCommercial.payload.technicalDescription);assert.equal(mapped.payload.rateLinkPending,false);
  for(const key of ['63A 1P AC VPD','CH-VPD-2P','CH-VPD-63A/2P']){
   const rows=fixedPreparationRows({siteId:randomUUID(),customer:'UBL',installation:true,items:[{key,description:'VPD 2P',qty:'1',unit:'Each'}]},current.catalogue,()=>randomUUID(),current.aliases);
   assert.equal(rows.length,1);assert.equal(rows[0].itemId,'CH-VPD-63A/2P');assert.equal(rows[0].unit,'piece');assert.equal(rows[0].out,'1');
  }
  assert.equal(current.aliases['CH-VPD-2P'],'CH-VPD-63A/2P');assert.equal(current.aliases['63A 1P AC VPD'],'CH-VPD-63A/2P');
  assert.equal(current.aliases['CH-Cable-DC-6MM'],undefined);
  const aliases=(await db.pool.query('SELECT * FROM inventory_final_stock_aliases ORDER BY old_id,item_id')).rows;
  await migrate(db.pool,undefined,true);assert.deepEqual((await db.pool.query('SELECT * FROM inventory_final_stock_aliases ORDER BY old_id,item_id')).rows,aliases);assert.deepEqual(await snapshot(),before);
 }finally{await db.close();await rm(pre,{recursive:true,force:true});}
});
