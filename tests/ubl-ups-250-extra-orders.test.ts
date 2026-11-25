import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testDatabase} from './database.js';
import {growingProgrammes,validProgrammeOrder,isExtraOrder,extraOrderLabel} from '../shared/extra-programme-orders.js';
import {sharedOrderLabel} from '../shared/shared-ipo-order.js';
import {orderSlotSummary,slotIdentity,freeSlotsBefore,requireFreedSlotsFirst} from '../server/project-workflow/order-slots.js';
import {manualIpoAvailable} from '../server/documents/manual-ipo.js';
import {projectManagementProgrammes} from '../server/director/management-programmes.js';

// Owner request, 25 Nov 2026: UBL UPS 250 takes extra orders above its target (251/250 …), labelled
// "Extra order (250+)", freed slots first, no approval. Every other programme keeps unit ≤ total.

test('only UBL UPS 250 may hold an order above its target',()=>{
 assert.equal(validProgrammeOrder('251/250',{configurationKey:'UBL-UPS-6-10'}),true);
 assert.equal(validProgrammeOrder('999/250',{customer:'ubl'}),true);
 assert.equal(validProgrammeOrder('20/250',{configurationKey:'UBL-UPS-6-10'}),true);
 for(const [order,from] of [['251/250',{configurationKey:'MBL-UPS-6-5'}],['61/60',{configurationKey:'MBL-UPS-6-5'}],['61/60',{customer:'MBL'}],['71/70',{customer:'UBL'}],['251/250',{customer:'MBL'}],['0/250',{configurationKey:'UBL-UPS-6-10'}],['251',{configurationKey:'UBL-UPS-6-10'}]] as const)
  assert.equal(validProgrammeOrder(order,from),false,order+' '+JSON.stringify(from));
 assert.equal(isExtraOrder('251/250'),true);assert.equal(isExtraOrder('250/250'),false);
 assert.equal(extraOrderLabel('251/250'),'Extra order (250+)');assert.equal(extraOrderLabel('213/250'),null);
 assert.equal(sharedOrderLabel('251/250'),'Order No. 251 · Target Sites 250 · Extra order (250+)');
 assert.equal(sharedOrderLabel('213/250'),'Order No. 213 · Target Sites 250','Orders inside the target look as before.');
});

test('the database guard follows the same programme list',()=>{
 const sql=readFileSync(new URL('../migrations/312_ubl_ups_extra_orders.sql',import.meta.url),'utf8');
 for(const g of growingProgrammes)assert.ok(sql.includes(`config='${g.configurationKey}' AND split_part(unit,'/',2)='${g.target}'`),g.configurationKey);
});

const id=(order:string)=>slotIdentity('UBL','CHP-163',order)!;
const active=(orders:number[])=>orders.map(n=>({...id(n+'/250'),site:'Site '+n,siteCode:'S'+n,ipoId:null}));
const range=(from:number,to:number)=>Array.from({length:to-from+1},(_,i)=>from+i);

test('freed slots come first, and extra orders follow in sequence',()=>{
 const full=active(range(1,250));
 assert.deepEqual(freeSlotsBefore(full,id('251/250')),[],'All 250 in use: 251 may be issued.');
 assert.deepEqual(freeSlotsBefore(full,id('253/250')),[251,252],'253 waits for 251 and 252.');
 assert.deepEqual(freeSlotsBefore(active([...range(1,146),...range(148,250)]),id('251/250')),[147],'A cancelled site frees 147: use it before 251.');
 assert.deepEqual(freeSlotsBefore(active([...range(1,250),251,253]),id('254/250')),[252],'A freed extra slot is reused first too.');
 assert.deepEqual(freeSlotsBefore(full,id('100/250')),[],'Orders inside the target are not affected.');
 assert.deepEqual(freeSlotsBefore([],id('251/250')),[],'An IPO number with no orders has no free slots to fill.');
 const summary=orderSlotSummary(active([...range(1,250),251,252,254]),[]).programmes[0];
 assert.deepEqual({capacity:summary.capacity,extra:summary.extra,inUse:summary.inUse,free:summary.free},{capacity:250,extra:3,inUse:253,free:[253]});
});

test('Bank programmes counts extra orders and keeps 250 as the target',()=>{
 const ups=(order:string)=>({key:'UBL:UPS:'+order,kind:'UPS',program:'UPS 250',ipo:'CHP-163',orderNumber:order,site:'Fictional '+order,customer:'UBL',grossContract:'900000',singleInvoiceSubmitted:false,singlePaymentReceived:false,delivered:false,installed:false,invoiceReferences:[],accountsReferences:[]});
 const rows=[...range(1,250),251,252].map(n=>ups(n+'/250'));
 const p=projectManagementProgrammes({registers:[{rows}],cables:{rows:[]},internet:{rows:[]}},'2026-11-25',1).programmes.find(p=>p.key==='ubl-ups-250')!;
 assert.deepEqual([p.orders.target,p.orders.valid,p.orders.remaining,p.orders.extra],[250,252,0,2]);
});

async function ublIpo(pool:any,number:string,order:string,key='UBL-UPS-6-10'){
 const user=randomUUID(),po=randomUUID(),ipo=randomUUID();
 await pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Extra fixture','Coordinator','fixture')",[user,user+'@test.invalid']);
 const customer=(await pool.query("SELECT customer_id FROM project_framework_current WHERE configuration_key=$1",[key])).rows[0].customer_id;
 await pool.query('INSERT INTO customer_purchase_orders(id,customer_id,po_number,input,created_by) VALUES($1,$2,$3,$4,$5)',[po,customer,'PO-'+ipo,{},user]);
 await pool.query('INSERT INTO internal_purchase_orders(id,customer_po_id,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[ipo,po,number,{approvedCommercialSource:{key},input:{orderNumber:order,poNumber:'PO-'+ipo},siteName:'Fixture '+order,siteCode:'FX-'+order.split('/')[0]},'fixture',randomUUID(),user]);
 await pool.query("INSERT INTO document_reference_roots(document_type,family_id,reference) VALUES('IPO',$1,$2) ON CONFLICT DO NOTHING",[ipo,number]);
 return {user,ipo,customer,context:{customerId:customer,configurationKey:key}};
}

test('database and IPO number check accept UBL extra orders, refuse them elsewhere, and want freed slots first',async()=>{
 const db=await testDatabase();
 try{
  const first=await ublIpo(db.pool,'CHP-EXTRA','250/250');
  assert.equal(await manualIpoAvailable(db.pool,'CHP-EXTRA',undefined,'251/250',first.context),true);
  await ublIpo(db.pool,'CHP-EXTRA','251/250');
  await assert.rejects(ublIpo(db.pool,'CHP-EXTRA','251/250'),/already in use/,'An extra slot is taken like any other.');
  await assert.rejects(ublIpo(db.pool,'CHP-EXTRA','252/255'),/already in use/,'The total stays 250 on every order of the IPO.');
  const mbl=await ublIpo(db.pool,'CHP-MBL-EXTRA','60/60','MBL-UPS-6-5');
  assert.equal(await manualIpoAvailable(db.pool,'CHP-MBL-EXTRA',undefined,'61/60',mbl.context),false);
  await assert.rejects(ublIpo(db.pool,'CHP-MBL-EXTRA','61/60','MBL-UPS-6-5'),/already in use/,'Other programmes keep their ceiling.');
  // Register orders 1–249 of the same IPO are active: with 250 and 251 issued, 252 is next.
  const version=Number((await db.pool.query('SELECT coalesce(max(version),0)+1 AS v FROM accounts_source_registers')).rows[0].v);
  const register=(cancelled:number[])=>range(1,249).map(n=>({key:'UBL:UPS:X'+n,kind:'UPS',customer:'UBL',ipo:'CHP-EXTRA',orderNumber:n+'/250',site:'Register '+n,siteCode:'R'+n,cancelled:cancelled.includes(n)}));
  await db.pool.query('INSERT INTO accounts_source_registers(id,version,source_sha256,source_date,snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),version,String(version).padStart(64,'e'),'2026-11-25',{registers:[{rows:register([])}]},first.user]);
  await requireFreedSlotsFirst(db.pool,first.context,'CHP-EXTRA','252/250');
  await assert.rejects(requireFreedSlotsFirst(db.pool,first.context,'CHP-EXTRA','253/250'),/Order slot 252\/250 of IPO CHP-EXTRA is free/);
  await db.pool.query('INSERT INTO accounts_source_registers(id,version,source_sha256,source_date,snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),version+1,String(version+1).padStart(64,'e'),'2026-11-25',{registers:[{rows:register([147])}]},first.user]);
  await assert.rejects(requireFreedSlotsFirst(db.pool,first.context,'CHP-EXTRA','252/250'),/Order slot 147\/250 of IPO CHP-EXTRA is free/,'A cancelled site frees 147: use it first.');
  await requireFreedSlotsFirst(db.pool,first.context,'CHP-EXTRA','147/250');
  await requireFreedSlotsFirst(db.pool,mbl.context,'CHP-MBL-EXTRA','61/60');
 }finally{await db.close();}
});
