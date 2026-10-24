import {exportBackup,restoreBackup} from '../server/backups/archive.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {testDatabase} from './database.js';
import {migrate} from '../server/db/migrate.js';
import {manualIpoAvailable} from '../server/documents/manual-ipo.js';

test('shared UPS numbering upgrades an existing issued IPO without changing documents, master rows or stock',async()=>{
 const db=await testDatabase({skipMigrations:true}),before=await mkdtemp(join(tmpdir(),'pz-before-ups-numbering-'));
 try{
  for(const name of await readdir(resolve('migrations')))if(name.endsWith('.sql')&&!name.startsWith('102_'))await copyFile(resolve('migrations',name),join(before,name));
  await migrate(db.pool,before);
  const user=randomUUID(),po=randomUUID(),ipo=randomUUID();
  await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Existing UPS fixture','Coordinator','fixture')",[user,user+'@test.invalid']);
  const customer=(await db.pool.query("SELECT customer_id FROM project_framework_current WHERE configuration_key='MBL-UPS-6-5'")).rows[0].customer_id;
  await db.pool.query('INSERT INTO customer_purchase_orders(id,customer_id,po_number,input,created_by) VALUES($1,$2,$3,$4,$5)',[po,customer,'OLD-UPS-PO',{},user]);
  const snapshot={approvedCommercialSource:{key:'MBL-UPS-6-5'},input:{orderNumber:'1/60'},immutableEvidence:'Keep original signed values'};
  await db.pool.query('INSERT INTO internal_purchase_orders(id,customer_po_id,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[ipo,po,'CHP-OLD-UPS',snapshot,'original',randomUUID(),user]);
  await db.pool.query("INSERT INTO document_reference_roots(document_type,family_id,reference) VALUES('IPO',$1,'CHP-OLD-UPS')",[ipo]);
  const original=(await db.pool.query('SELECT * FROM internal_purchase_orders WHERE id=$1',[ipo])).rows[0];
  await migrate(db.pool,resolve('migrations'),true);
  await migrate(db.pool,resolve('migrations'),true);
  assert.deepEqual((await db.pool.query('SELECT * FROM internal_purchase_orders WHERE id=$1',[ipo])).rows[0],original);
  assert.equal(await manualIpoAvailable(db.pool,'CHP-OLD-UPS',undefined,'2/60',{customerId:customer,configurationKey:'MBL-UPS-6-5'}),true);
  assert.equal(await manualIpoAvailable(db.pool,'CHP-OLD-UPS',undefined,'1/60',{customerId:customer,configurationKey:'MBL-UPS-6-5'}),false);
  const secondPo=randomUUID(),secondIpo=randomUUID();await db.pool.query('INSERT INTO customer_purchase_orders(id,customer_id,po_number,input,created_by) VALUES($1,$2,$3,$4,$5)',[secondPo,customer,'SECOND-UPS-PO',{},user]);
  await db.pool.query('INSERT INTO internal_purchase_orders(id,customer_po_id,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[secondIpo,secondPo,'CHP-OLD-UPS',{...snapshot,input:{orderNumber:'2/60'}},'second',randomUUID(),user]);
  assert.equal((await db.pool.query("SELECT count(*) AS n FROM internal_purchase_orders WHERE number='CHP-OLD-UPS'")).rows[0].n,'2');
  await db.pool.query("INSERT INTO document_reference_aliases(document_type,family_id,reference) VALUES('IPO',$1,'CHP-OLD-UPS')",[secondIpo]);
  const archive=await exportBackup(db.pool,'isolated-ups-backup-passphrase'),restored=await testDatabase({skipMigrations:true});
  try{await restoreBackup(restored.pool,archive.path,'isolated-ups-backup-passphrase');assert.equal((await restored.pool.query("SELECT count(*) AS n FROM internal_purchase_orders WHERE number='CHP-OLD-UPS'")).rows[0].n,'2');assert.equal((await restored.pool.query('SELECT reference FROM document_reference_aliases WHERE family_id=$1',[secondIpo])).rows[0].reference,'CHP-OLD-UPS');}finally{await archive.cleanup();await restored.close();}

 }finally{await db.close();await rm(before,{recursive:true,force:true});}
});
