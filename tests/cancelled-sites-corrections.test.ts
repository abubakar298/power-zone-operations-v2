import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {cancelledSitesForCoordination,orderSlotSummary,slotIdentity,freeSlotsBefore} from '../server/project-workflow/order-slots.js';
import {correctedOrderNumber} from '../server/project-workflow/order-number-corrections.js';

const range=(from:number,to:number)=>Array.from({length:to-from+1},(_,i)=>from+i);
const moved=[16,42,46,50,56,57,58,59,61,71,72,73];

test('kept as before: UBL UPS 250 shows its extra orders; a cancelled register order frees its slot',()=>{
 const id=(order:string)=>slotIdentity('UBL','CHP-163',order)!;
 const active=[...range(1,153),...range(155,252)].map(unit=>({...id(`${unit}/250`),site:'A',siteCode:'A',ipoId:null}));
 const cancelled=[{...id('154/250'),id:'register:154',source:'Reviewed register' as const,outcome:'Cancelled' as const,site:'Naseerabad',siteCode:'',po:'',ipoId:null,recordId:null,projectKey:null,cancelledAt:'2026-10-26',cancelledBy:null,reason:''}];
 const p=orderSlotSummary(active,cancelled).programmes[0];
 assert.deepEqual([p.capacity,p.extra,p.inUse,p.freeCount,p.free],[250,2,251,1,[154]]);
});

test('transferred orders live on in their new IPO: their old number is neither free nor a cancelled site',()=>{
 const id=(order:string)=>slotIdentity('MBL','CHP-220',order)!;
 const active=range(1,74).filter(unit=>!moved.includes(unit)).map(unit=>({...id(`${unit}/62`),site:'S'+unit,siteCode:'C'+unit,ipoId:null}));
 const closed=moved.map(unit=>id(`${unit}/62`));
 const p=orderSlotSummary(active,[],closed).programmes[0];
 assert.deepEqual([p.capacity,p.extra,p.inUse,p.freeCount,p.free],[62,0,62,0,[]],'CHP-220: 62 slots, all filled, no extra-order note.');
 // A growing programme's transferred slot is not "free first" either.
 const ubl=(order:string)=>slotIdentity('UBL','CHP-163',order)!;
 const full=range(1,250).filter(unit=>unit!==36).map(unit=>({...ubl(`${unit}/250`),site:'A',siteCode:'A',ipoId:null}));
 assert.deepEqual(freeSlotsBefore(full,ubl('251/250'),[ubl('36/250')]),[]);
 assert.deepEqual(freeSlotsBefore(full,ubl('251/250')),[36],'Without the transfer, 36 would be free.');
});

test('the CHP-233 order typed 3/60 is read as 3/20; nothing else is corrected',()=>{
 assert.equal(correctedOrderNumber({customer:'MBL',ipo:'CHP-233',order:'3/60',siteCode:'0126'}),'3/20');
 assert.equal(correctedOrderNumber({customer:'mbl',ipo:'chp-233',order:' 3/60 ',siteCode:'0126'}),'3/20');
 assert.equal(correctedOrderNumber({customer:'MBL',ipo:'CHP-233',order:'4/60',siteCode:'0126'}),'4/60');
 assert.equal(correctedOrderNumber({customer:'MBL',ipo:'CHP-233',order:'3/60',siteCode:'0127'}),'3/60');
 assert.equal(correctedOrderNumber({customer:'UBL',ipo:'CHP-233',order:'3/60',siteCode:'0126'}),'3/60');
});

test('Coordination window: one CHP-233 row of 20 slots, CHP-220 full at 62, CHP-338 counts its moved sites once, no transferred sites listed',async()=>{
 const db=await testDatabase();
 try{
  const user=randomUUID();
  await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Correction fixture','Coordinator','fixture')",[user,user+'@test.invalid']);
  const customer=(await db.pool.query("SELECT customer_id FROM project_framework_current WHERE configuration_key='MBL-UPS-6-5'")).rows[0].customer_id;
  assert.equal((await db.pool.query('SELECT upper(short_code) AS code FROM customers WHERE id=$1',[customer])).rows[0].code,'MBL');
  const po=randomUUID(),ipo=randomUUID();
  await db.pool.query('INSERT INTO customer_purchase_orders(id,customer_id,po_number,input,created_by) VALUES($1,$2,$3,$4,$5)',[po,customer,'PO-'+ipo,{},user]);
  await db.pool.query('INSERT INTO internal_purchase_orders(id,customer_po_id,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[ipo,po,'CHP-233',{approvedCommercialSource:{key:'MBL-UPS-6-5'},input:{orderNumber:'3/60',poNumber:''},siteName:'New Chaali Barnch',siteCode:'0126'},'fixture',randomUUID(),user]);
  const row=(ipoNumber:string,order:string,extra:any={})=>({key:`MBL:${ipoNumber}:${order}`,kind:'UPS',customer:'MBL',ipo:ipoNumber,orderNumber:order,site:`${ipoNumber} ${order}`,siteCode:'',cancelled:false,transferred:false,...extra});
  const rows=[
   ...[1,2,3].map(unit=>row('CHP-233',`${unit}/20`)),
   ...range(1,74).map(unit=>row('CHP-220',`${unit}/62`,moved.includes(unit)?{transferred:true,remarks:`Site has been shifted to IPO CHP-338 (${String(moved.indexOf(unit)+1).padStart(2,'0')}/60)`}:{})),
   ...range(1,35).filter(unit=>unit!==20).map(unit=>row('CHP-338',`${unit}/60`)),
  ];
  const version=Number((await db.pool.query('SELECT coalesce(max(version),0)+1 AS v FROM accounts_source_registers')).rows[0].v);
  await db.pool.query('INSERT INTO accounts_source_registers(id,version,source_sha256,source_date,snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),version,String(version).padStart(64,'d'),'2026-10-26',{registers:[{rows}]},user]);
  const view=await cancelledSitesForCoordination(db.pool,user);
  const shown=view.programmes.filter(p=>['CHP-233','CHP-220','CHP-338'].includes(p.ipo)).map(p=>[p.ipo,p.capacity,p.inUse,p.extra,p.freeCount]);
  assert.deepEqual(shown,[['CHP-220',62,62,0,0],['CHP-233',20,3,0,17],['CHP-338',60,34,0,26]]);
  assert.equal(view.sites.filter(s=>['CHP-220','CHP-233','CHP-338'].includes(s.ipo)).length,0,'No CHP-220 site is listed as cancelled.');
  // The issued IPO itself is unchanged.
  assert.equal((await db.pool.query("SELECT snapshot#>>'{input,orderNumber}' AS o FROM internal_purchase_orders WHERE id=$1",[ipo])).rows[0].o,'3/60');
 }finally{await db.close();}
});
