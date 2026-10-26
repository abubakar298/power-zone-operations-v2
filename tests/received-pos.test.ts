import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,copyFile,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {migrate} from '../server/db/migrate.js';
import {preservationSnapshot,requirePreserved} from '../server/db/preservation.js';
import {managementReceivedPos} from '../server/director/received-pos.js';

test('bulk received POs preserve every existing record, keep invoice identities separate, and never issue a workflow',async()=>{
 const db=await testDatabase({skipMigrations:true}),pre=await mkdtemp(join(tmpdir(),'pz-pre-bulk-pos-'));
 try{
  for(const name of await readdir('migrations'))if(/^\d+_.*\.sql$/.test(name)&&name!=='108_management_received_pos.sql')await copyFile(join('migrations',name),join(pre,name));
  await migrate(db.pool,pre);
  const c=await db.pool.connect();let before;try{before=await preservationSnapshot(c);}finally{c.release();}
  await migrate(db.pool,undefined,true);
  const after=await db.pool.connect();try{requirePreserved(before,await preservationSnapshot(after,false,before),'bulk PO import');}finally{after.release();}
  const admin=randomUUID(),coordinator=randomUUID();
  await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash)VALUES($1,'po-admin@example.test','PO admin','Management','unused'),($2,'po-coordinator@example.test','PO coordinator','Coordinator','unused')",[admin,coordinator]);
  const data=await managementReceivedPos(db.pool,admin);
  assert.equal(data.rows.length,327);assert.equal(new Set(data.rows.map((r:any)=>r.key)).size,327);
  assert.equal(data.rows.filter((r:any)=>r.customer==='UBL').length,209);
  assert.equal(data.rows.filter((r:any)=>r.customer==='MBL'&&r.transferred).length,12);
  assert.equal(data.rows.filter((r:any)=>r.customer==='MBL'&&r.variant==='6-10').length,3);
  const qasba=data.rows.find((r:any)=>r.customer==='UBL'&&r.orderNumber==='11/250');
  assert.deepEqual(qasba.accountsReferences,['2/250']);assert.equal(qasba.mappingStatus,'Linked by customer PO');
  const held=data.rows.find((r:any)=>r.customer==='UBL'&&r.orderNumber==='9/250');assert.deepEqual(held.accountsReferences,[]);assert.equal(held.mappingStatus,'Mapping review required');
  const links=new Set();for(const r of data.rows.filter((r:any)=>r.active))for(const n of r.accountSourceRows){const key=r.customer+':'+n;assert(!links.has(key),'one invoice must not be attached to two active POs');links.add(key);}
  assert.equal(data.policy.workflowIssuances,0);assert.equal(data.policy.stockWrites,0);assert.equal(data.policy.costWrites,0);assert.equal(data.policy.paymentWrites,0);
  await assert.rejects(managementReceivedPos(db.pool,coordinator),/Management access/);
  await migrate(db.pool,undefined,true);assert.equal((await managementReceivedPos(db.pool,admin)).rows.length,327);
  await assert.rejects(db.pool.query("DELETE FROM management_received_po_batches"),/immutable/);
  const sql=await readFile('migrations/108_management_received_pos.sql','utf8');assert(!/INSERT INTO (project_workflow|project_po|internal_purchase|inventory_|accounts_)/i.test(sql));
 }finally{await db.close();await rm(pre,{recursive:true,force:true});}
});
