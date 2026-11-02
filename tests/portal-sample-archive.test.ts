import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';import {archivePortalSamples,portalSampleArchivePlan} from '../server/maintenance/portal-sample-archive.js';import {MastersRepository} from '../server/masters/repository.js';
test('confirmed portal samples are archived recoverably; real sites, financials and stock remain unchanged',async()=>{
 const db=await testDatabase();try{
 const actor=randomUUID(),other=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,'sample-cleanup@example.test','Owner','Management','test'),($2,'sample-reader@example.test','Reader','Coordinator','test')",[actor,other]);
 await db.pool.query("INSERT INTO customers(id,name,short_code,contact_person,phone,email,address,status,notes) VALUES(344,'Bhai Bhai Oil','BBO','','','','','Active',''),(9999,'Real sample equipment company','REAL','','','','','Active','') ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name");
 await db.pool.query("INSERT INTO sites(id,customer_id,name,code,status) VALUES(9999,344,'DHA Rehbar','DR1','Active'),(9998,9999,'Real customer site','REAL','Active')");
 const plan=await portalSampleArchivePlan(db.pool);assert.ok(plan.records.portalCustomerIds.includes('344'));assert.ok(!plan.records.portalCustomerIds.includes('9999'));assert.ok(plan.records.portalSiteIds.includes('9999'));assert.ok(!plan.records.portalSiteIds.includes('9998'));
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM test_workflow_archives WHERE key=$1',[plan.key])).rows[0].n,0);
 await assert.rejects(archivePortalSamples(db.pool,other),/Management access required/);
 const before=(await db.pool.query('SELECT count(*)::int n FROM customers')).rows[0].n;
 const counts=await archivePortalSamples(db.pool,actor);assert.deepEqual(await archivePortalSamples(db.pool,actor),counts);
 const masters=await new MastersRepository(db.pool).list();assert.ok(!masters.customers.some((c:any)=>c.id===344));assert.ok(masters.customers.some((c:any)=>c.id===9999));assert.ok(!masters.sites.some((s:any)=>s.id===9999));assert.ok(masters.sites.some((s:any)=>s.id===9998));assert.equal((await db.pool.query('SELECT count(*)::int n FROM customers')).rows[0].n,before);
 assert.equal((await db.pool.query('SELECT name FROM customers WHERE id=344')).rows[0].name,'Bhai Bhai Oil');
 for(const table of ['accounts_payment_records','accounts_invoice_entries','accounts_pt_entries','stock_on_hand_entries'])assert.equal((await db.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);
 }finally{await db.close();}
});
