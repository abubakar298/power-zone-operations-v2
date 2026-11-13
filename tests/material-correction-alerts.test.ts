import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {flagMaterialCorrection,materialCorrectionAlerts,resolveMaterialCorrection} from '../server/inventory/material-correction-alerts.js';
test('Management correction flags are visible to both portals without editing reconciliations, stock or closures',async()=>{
 const db=await testDatabase();try{
  const owner=randomUUID(),accounts=randomUUID();for(const [id,role] of [[owner,'Management'],[accounts,'Accounts']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role,role,'isolated']);
  const input={ipoNumber:'306',message:'Owner confirmed 138m red +120m black; review only, closed job unchanged.',requestKey:randomUUID()};
  await assert.rejects(flagMaterialCorrection(db.pool,accounts,input),/Management/);
  const before=(await db.pool.query('SELECT count(*) n FROM inventory_report_versions')).rows[0].n;
  const a=await flagMaterialCorrection(db.pool,owner,input);assert.equal((await flagMaterialCorrection(db.pool,owner,input)).id,a.id);
  const alerts=(await materialCorrectionAlerts(db.pool)).alerts;assert.equal(alerts.length,1);assert.equal(alerts[0].legacy_ipo_number,'306');assert.match(alerts[0].message,/138m/);
  assert.equal((await db.pool.query('SELECT count(*) n FROM inventory_report_versions')).rows[0].n,before);
  assert.equal((await db.pool.query('SELECT count(*) n FROM inventory_material_dispatches')).rows[0].n,'0');
 }finally{await db.close();}
});
test('a resolved correction leaves the open list; the alert and who resolved it are kept',async()=>{
 const db=await testDatabase();try{
  const users:Record<string,string>={};for(const [key,role] of [['owner','Management'],['accounts','Accounts'],['coordinator','Coordinator'],['storekeeper','Inventory'],['dispatcher','Inventory']]){users[key]=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[users[key],key+'@example.test',key,role,'isolated']);}
  await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$3),($2,'Lahore warehouse','storekeeper',$3)",[users.dispatcher,users.storekeeper,users.owner]);
  const first=await flagMaterialCorrection(db.pool,users.owner,{ipoNumber:'306',message:'Owner confirmed 138m red +120m black; review only.',requestKey:randomUUID()});
  const second=await flagMaterialCorrection(db.pool,users.owner,{ipoNumber:'306',message:'Second correction for the same site; review only.',requestKey:randomUUID()});
  const resolve={note:'PT corrected to 258 m and reconciliation updated.',requestKey:randomUUID()};
  for(const key of ['coordinator','storekeeper'])await assert.rejects(resolveMaterialCorrection(db.pool,users[key],first.id,{...resolve,requestKey:randomUUID()}),/resolves reconciliation corrections/);
  await assert.rejects(resolveMaterialCorrection(db.pool,users.accounts,first.id,{note:' ',requestKey:randomUUID()}),/Write how/);
  await assert.rejects(resolveMaterialCorrection(db.pool,users.accounts,'material-recon:missing',{...resolve,requestKey:randomUUID()}),/not found/);
  await resolveMaterialCorrection(db.pool,users.accounts,first.id,resolve);
  assert.deepEqual(await resolveMaterialCorrection(db.pool,users.accounts,first.id,resolve),{id:first.id,resolved:true},'retry is safe');
  await assert.rejects(resolveMaterialCorrection(db.pool,users.dispatcher,first.id,{...resolve,requestKey:randomUUID()}),/already resolved/);
  assert.deepEqual((await materialCorrectionAlerts(db.pool)).alerts.map((a:any)=>a.id),[second.id]);
  await resolveMaterialCorrection(db.pool,users.dispatcher,second.id,{note:'Inventory verified the parent reconciliation.',requestKey:randomUUID()});
  assert.equal((await materialCorrectionAlerts(db.pool)).alerts.length,0);
  // Nothing is deleted or edited: both alerts remain, with their resolutions.
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM ubl_documentation_alerts WHERE id LIKE 'material-recon:%' AND status='Open'")).rows[0].n,2);
  const saved=(await db.pool.query('SELECT alert_id,note,resolved_by FROM ubl_documentation_alert_resolutions ORDER BY resolved_at')).rows;
  assert.deepEqual(saved.map(r=>[r.alert_id,r.resolved_by]),[[first.id,users.accounts],[second.id,users.dispatcher]]);
  await assert.rejects(db.pool.query('DELETE FROM ubl_documentation_alert_resolutions'));
 }finally{await db.close();}
});
