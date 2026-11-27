import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectManagementProgrammes,appendIssuedProgrammeSales,withOperationsCancellations} from '../server/director/management-programmes.js';
import {testDatabase} from './database.js';
import {manualIpoAvailable} from '../server/documents/manual-ipo.js';
import {cancelledSitesForCoordination,orderSlotSummary,slotIdentity} from '../server/project-workflow/order-slots.js';
import {slotRanges} from '../shared/order-slot-ranges.js';

async function cancelInOperations(pool:any,user:string,ipo:string,name:string,reason:string){
 const site='ipo-'+ipo;
 await pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[site,user]);
 await pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,$3,$4,$5,$6)',[site,{id:site,name,origin:{ipoId:ipo},stage:'received'},'create','Created from IPO',randomUUID(),user]);
 await pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,2,$2,$3,$4,$5,$6)',[site,{id:site,name,origin:{ipoId:ipo},stage:'received',cancelled:true,cancellation:{reason,cancelledBy:'Moaz',cancelledAt:'2026-11-21T08:00:00.000Z',proof:[]}},'cancel-site',reason,randomUUID(),user]);
 await pool.query("INSERT INTO operations_board_events(id,site_id,site_version,kind,audiences,created_by) VALUES($1,$2,2,'Site cancelled','[]',$3)",[randomUUID(),site,user]);
}
const newUser=async(pool:any,role:string)=>(await pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,'fixture') RETURNING id",[randomUUID(),randomUUID()+'@test.invalid','Slot '+role,role])).rows[0].id as string;

test('a site the Operations head cancels frees its slot: the same order number can be issued again and the cancelled site stays listed',async()=>{
 const db=await testDatabase();
 try{
  const first=await sharedIpo(db.pool,'CHP-SLOT','1/60');await sharedIpo(db.pool,'CHP-SLOT','2/60');
  assert.equal(await manualIpoAvailable(db.pool,'CHP-SLOT',undefined,'1/60',first.context),false,'Before the cancellation the slot is taken.');
  await cancelInOperations(db.pool,first.user,first.ipo,'Fixture branch 1/60','Customer said cancel for now');
  assert.equal(await manualIpoAvailable(db.pool,'CHP-SLOT',undefined,'1/60',first.context),true,'The cancelled order frees slot 1/60.');
  assert.equal(await manualIpoAvailable(db.pool,'CHP-SLOT',undefined,'2/60',first.context),false,'An active order still holds its slot.');
  assert.equal(await manualIpoAvailable(db.pool,'CHP-SLOT',undefined,'3/80',first.context),false,'The total must still match.');
  const coordinator=await newUser(db.pool,'Coordinator');
  let view=await cancelledSitesForCoordination(db.pool,coordinator);
  const programme=view.programmes.find(p=>p.ipo==='CHP-SLOT')!;
  assert.deepEqual({capacity:programme.capacity,inUse:programme.inUse,freeCount:programme.freeCount},{capacity:60,inUse:1,freeCount:59});
  assert.equal(programme.free[0],1);
  const cancelled=view.sites.filter(s=>s.ipo==='CHP-SLOT');
  assert.equal(cancelled.length,1);assert.equal(cancelled[0].sr,1);assert.equal(cancelled[0].order,'1/60');assert.equal(cancelled[0].slot,'Free');
  assert.equal(cancelled[0].reason,'Customer said cancel for now');assert.equal(cancelled[0].ipoId,first.ipo);assert.equal(cancelled[0].cancelledBy,'Moaz');
  // The renewed order takes slot 1/60; the cancelled IPO is unchanged and still listed.
  const before=(await db.pool.query('SELECT * FROM internal_purchase_orders WHERE id=$1',[first.ipo])).rows[0];
  await sharedIpo(db.pool,'CHP-SLOT','1/60','Renewed branch');
  assert.deepEqual((await db.pool.query('SELECT * FROM internal_purchase_orders WHERE id=$1',[first.ipo])).rows[0],before);
  assert.equal(await manualIpoAvailable(db.pool,'CHP-SLOT',undefined,'1/60',first.context),false,'Once reused, the slot is taken again.');
  view=await cancelledSitesForCoordination(db.pool,coordinator);
  const reused=view.sites.find(s=>s.ipo==='CHP-SLOT')!;
  assert.equal(reused.slot,'In use again');assert.equal(reused.reusedBy?.site,'Renewed branch');assert.equal(reused.site,'Fixture branch 1/60');
  assert.equal(view.programmes.find(p=>p.ipo==='CHP-SLOT')!.freeCount,58);
  await assert.rejects(cancelledSitesForCoordination(db.pool,await newUser(db.pool,'Accounts')),/Coordination and Management/);
 }finally{await db.close();}
});

test('an imported historical order the reviewed register lists as cancelled frees its slot too; an active register order does not',async()=>{
 const db=await testDatabase();
 try{
  const cancelledOld=await sharedIpo(db.pool,'CHP-HIST','5/60','Historical cancelled branch',{historicalImport:{source:'fixture'}});
  await sharedIpo(db.pool,'CHP-HIST','6/60','Historical active branch',{historicalImport:{source:'fixture'}});
  const version=Number((await db.pool.query('SELECT coalesce(max(version),0)+1 AS v FROM accounts_source_registers')).rows[0].v);
  const rows=[{key:'MBL:UPS:5/60',kind:'UPS',customer:'MBL',ipo:'CHP-HIST',orderNumber:'5/60',site:'Historical cancelled branch',siteCode:'H5',cancelled:true,cancellationOutcome:'Cancelled. No replacement confirmed.'},
   {key:'MBL:UPS:6/60',kind:'UPS',customer:'MBL',ipo:'CHP-HIST',orderNumber:'6/60',site:'Historical active branch',siteCode:'H6',cancelled:false}];
  await db.pool.query('INSERT INTO accounts_source_registers(id,version,source_sha256,source_date,snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),version,String(version).padStart(64,'c'),'2026-10-26',{registers:[{rows}]},cancelledOld.user]);
  assert.equal(await manualIpoAvailable(db.pool,'CHP-HIST',undefined,'5/60',cancelledOld.context),true);
  assert.equal(await manualIpoAvailable(db.pool,'CHP-HIST',undefined,'6/60',cancelledOld.context),false);
  await sharedIpo(db.pool,'CHP-HIST','5/60','Renewed historical branch');
  await assert.rejects(sharedIpo(db.pool,'CHP-HIST','6/60','Duplicate of an active order'),/already in use/,'The database still refuses an active order number.');
  await assert.rejects(sharedIpo(db.pool,'CHP-HIST','5/60','Second reuse'),/already in use/,'A reused slot is taken again.');
  const view=await cancelledSitesForCoordination(db.pool,await newUser(db.pool,'Management'));
  const site=view.sites.find(s=>s.ipo==='CHP-HIST')!;
  assert.deepEqual([site.order,site.source,site.slot,site.reusedBy?.site,site.reason],['5/60','Reviewed register','In use again','Renewed historical branch','Cancelled. No replacement confirmed.']);
  assert.equal(view.sites.filter(s=>s.ipo==='CHP-HIST').length,1,'The imported IPO and its register row are one cancelled site.');
 }finally{await db.close();}
});

test('a normal (not shared UPS) IPO number stays unique in the database',async()=>{
 const db=await testDatabase();
 try{
  const first=await sharedIpo(db.pool,'CHP-NORMAL-1','1/60','Normal site',{approvedCommercialSource:{key:'UBL-SOLAR'}});
  await assert.rejects(sharedIpo(db.pool,'chp-normal-1','2/60','Second normal site',{approvedCommercialSource:{key:'UBL-SOLAR'}}),/already in use|duplicate key/);
  await cancelInOperations(db.pool,first.user,first.ipo,'Normal site','Cancelled');
  await assert.rejects(sharedIpo(db.pool,'CHP-NORMAL-1','1/60','Same number after cancellation',{approvedCommercialSource:{key:'UBL-SOLAR'}}),/already in use|duplicate key/);
 }finally{await db.close();}
});

test('free slots and the cancelled list: SR# from 1, oldest cancellation first, register cancellations included',()=>{
 const id=(order:string)=>slotIdentity('UBL','CHP-163',order)!;
 const active=['1/250','2/250','4/250'].map(order=>({...id(order),site:'Active '+order,siteCode:'A',ipoId:null}));
 const cancelled=[
  {...id('3/250'),id:'operations:x',source:'Operations' as const,outcome:'Cancelled' as const,site:'Later branch',siteCode:'L',po:'',ipoId:'x',recordId:'r',projectKey:null,cancelledAt:'2026-11-21T08:00:00.000Z',cancelledBy:'Moaz',reason:'Cancel for now'},
  {...id('2/250'),id:'register:y',source:'Reviewed register' as const,outcome:'Cancelled' as const,site:'Old branch',siteCode:'O',po:'P',ipoId:null,recordId:null,projectKey:null,cancelledAt:'2026-10-26',cancelledBy:null,reason:''},
 ];
 const summary=orderSlotSummary(active,cancelled);
 assert.deepEqual(summary.programmes.map(p=>[p.ipo,p.capacity,p.inUse,p.freeCount]),[['CHP-163',250,3,247]]);
 assert.equal(slotRanges(summary.programmes[0].free),'3, 5–250');
 assert.deepEqual(summary.sites.map(s=>[s.sr,s.order,s.slot]),[[1,'2/250','In use again'],[2,'3/250','Free']]);
 assert.equal(slotIdentity('UBL','CHP-163-R1','5/250')!.programme,slotIdentity('UBL','chp-163','5/250')!.programme,'A revised IPO keeps its slots.');
 // Owner, 25 Nov 2026: UBL UPS 250 grows past its target, so an extra order 251/250 is slot 251 of the same programme.
 assert.equal(slotIdentity('UBL','CHP-163','251/250')!.programme,slotIdentity('UBL','CHP-163','1/250')!.programme);
 assert.equal(summary.programmes[0].extra,0);
});

test('Management bank programmes: a cancelled order frees its number for a new IPO, which counts as active',()=>{
 const register=snapshot([ups('1/250',{po:'OLD-1'}),ups('154/250',{po:'OLD-154',cancelled:true,cancellationOutcome:'Cancelled for now'})]);
 const added=appendIssuedProgrammeSales(register,[sale('renewed','154/250')],'2026-10-26');
 const p=projectManagementProgrammes(added.snapshot,'2026-10-26',1).programmes.find(p=>p.key==='ubl-ups-250')!;
 assert.deepEqual(p.rows.map(r=>r.orderNumber).sort(),['1/250','154/250']);
 assert.equal(p.cancelled.length,1);assert.equal(p.cancelled[0].cancellationOutcome,'Cancelled for now');
 assert.equal(added.issues.length,0);assert.equal(p.orders.remaining,248);
 // A portal IPO the Operations head cancelled is listed as cancelled; its renewed order with the same number is active.
 const portal=appendIssuedProgrammeSales(snapshot([ups('1/250')]),[sale('old','9/250',{cancelled:true,cancellationOutcome:'Cancelled by Operations (Moaz) on 2026-11-21'}),sale('new','9/250')],'2026-10-26');
 const q=projectManagementProgrammes(portal.snapshot,'2026-10-26',1).programmes.find(p=>p.key==='ubl-ups-250')!;
 assert.equal(portal.issues.length,0);
 assert.deepEqual(q.rows.map(r=>r.key).sort(),['UBL:UPS:1/250','issued:new']);
 assert.deepEqual(q.cancelled.map(r=>[r.key,r.orderNumber,r.cancellationOutcome]),[['issued:old','9/250','Cancelled by Operations (Moaz) on 2026-11-21']]);
 // A register order whose Operations site was cancelled after the source date is cancelled too.
 const marked=withOperationsCancellations(snapshot([ups('7/250')]),new Map([['UBL:UPS:7/250',{siteId:'registered-UBL:UPS:7/250',ipoIds:[],sourceKey:'UBL:UPS:7/250',name:'',cancelledAt:'2026-11-21T08:00:00.000Z',cancelledBy:'Moaz',reason:'Bank closed branch'}]]));
 const r=projectManagementProgrammes(marked,'2026-10-26',1).programmes.find(p=>p.key==='ubl-ups-250')!;
 assert.equal(r.rows.length,0);assert.equal(r.cancelled[0].cancellationOutcome,'Cancelled by Operations (Moaz) on 2026-11-21. Reason: Bank closed branch');
});

const ups=(order:string,extra:any={})=>({key:'UBL:UPS:'+order,kind:'UPS',program:'UPS 250',ipo:'CHP-163',orderNumber:order,site:'Fictional '+order,customer:'UBL',grossContract:'900000',singleInvoiceSubmitted:false,singlePaymentReceived:false,delivered:false,installed:false,invoiceReferences:[],accountsReferences:[],...extra});
const snapshot=(rows:any[])=>({registers:[{rows}],cables:{rows:[]},internet:{rows:[]}});
const sale=(id:string,order:string,extra:any={})=>({id,recordId:'record-'+id,customer:'UBL',number:'CHP-163',orderNumber:order,site:'Fictional sale '+id,siteCode:'F-'+id,configuration:'6-10',poReference:'PO-'+id,grossContract:'100000',issuedAt:'2026-11-20T09:00:00Z',...extra});

test('kept as before: a new IPO on the order of an active register site stays held; a free order number is added once',()=>{
 const source=snapshot([ups('1/250',{po:'OLD-PO'})]);
 const added=appendIssuedProgrammeSales(source,[sale('collision','1/250'),sale('fresh','2/250')],'2026-10-26');
 const p=projectManagementProgrammes(added.snapshot,'2026-10-26',1).programmes.find(p=>p.key==='ubl-ups-250')!;
 assert.deepEqual(p.rows.map(r=>r.orderNumber).sort(),['1/250','2/250']);
 assert.ok(added.issues.some(issue=>issue.includes('collision')));
 assert.equal(p.orders.remaining,248);
});

test('kept as before: an issued shared IPO order refuses the same unit; another unit with the same total is accepted',async()=>{
 const db=await testDatabase();
 try{
  const fixture=await sharedIpo(db.pool,'CHP-SLOT-LOCK','1/60');
  assert.equal(await manualIpoAvailable(db.pool,'CHP-SLOT-LOCK',undefined,'1/60',fixture.context),false);
  assert.equal(await manualIpoAvailable(db.pool,'CHP-SLOT-LOCK',undefined,'2/60',fixture.context),true);
  assert.equal(await manualIpoAvailable(db.pool,'CHP-SLOT-LOCK',undefined,'2/80',fixture.context),false);
 }finally{await db.close();}
});

async function sharedIpo(pool:any,number:string,order:string,siteName='Fixture branch '+order,extra:Record<string,unknown>={}){
 const user=randomUUID(),po=randomUUID(),ipo=randomUUID();
 await pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Slot fixture','Coordinator','fixture')",[user,user+'@test.invalid']);
 const customer=(await pool.query("SELECT customer_id FROM project_framework_current WHERE configuration_key='MBL-UPS-6-5'")).rows[0].customer_id;
 await pool.query('INSERT INTO customer_purchase_orders(id,customer_id,po_number,input,created_by) VALUES($1,$2,$3,$4,$5)',[po,customer,'PO-'+ipo,{},user]);
 await pool.query('INSERT INTO internal_purchase_orders(id,customer_po_id,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[ipo,po,number,{approvedCommercialSource:{key:'MBL-UPS-6-5'},input:{orderNumber:order,poNumber:'PO-'+ipo},siteName,siteCode:'FX-'+order.split('/')[0],...extra},'fixture',randomUUID(),user]);
 await pool.query("INSERT INTO document_reference_roots(document_type,family_id,reference) VALUES('IPO',$1,$2) ON CONFLICT DO NOTHING",[ipo,number]);
 return {user,ipo,customer,context:{customerId:customer,configurationKey:'MBL-UPS-6-5'}};
}
