import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {flagMaterialCorrection,materialCorrectionAlerts} from '../server/inventory/material-correction-alerts.js';
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
