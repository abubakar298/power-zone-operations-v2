import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {MaterialDraftRepository} from '../server/inventory/material-drafts.js';
import {recentFirst} from '../shared/recent-records.js';

test('Inventory upcoming projects carry their latest Operations change, so the dashboard lists the most recently changed first',async()=>{
 const db=await testDatabase();try{
  const owner=randomUUID(),inventory=randomUUID();
  for(const [id,role] of [[owner,'Admin'],[inventory,'Inventory']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role,role,'isolated']);
  await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[inventory,owner]);
  // "older-site" was registered first but changed most recently; "newer-site" has not changed since registration.
  const versions:[string,number,string][]=[['older-site',1,'2026-11-01T08:00:00Z'],['newer-site',1,'2026-11-10T08:00:00Z'],['older-site',2,'2026-11-20T08:00:00Z']];
  for(const [id,version,at] of versions){
   if(version===1)await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[id,owner]);
   await db.pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,version,{id,ipo:'IPO-'+id,name:id,customer:'Test bank',stage:'received',installation:true},'Fixture','isolated fixture',randomUUID(),owner,at]);
  }
  const intake=await new MaterialDraftRepository(db.pool).intake(inventory);
  const pending=intake.registeredPending;
  assert.equal(pending.find(r=>r.siteId==='older-site')?.lastActivityAt,'2026-11-20T08:00:00.000Z');
  assert.equal(pending.find(r=>r.siteId==='newer-site')?.lastActivityAt,'2026-11-10T08:00:00.000Z');
  assert.deepEqual(recentFirst(pending).map(r=>r.siteId),['older-site','newer-site']);
 }finally{await db.close();}
});
