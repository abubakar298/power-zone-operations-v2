import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import request from 'supertest';
import {projectManagementProgrammes,managementProgrammes,appendIssuedProgrammeSales} from '../server/director/management-programmes.js';
import {testDatabase} from './database.js';
import {AccountsSourceRegisters} from '../server/accounts/source-registers.js';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import {digest} from '../server/auth/crypto.js';
const ups=(key:string,extra:any={})=>({key:'UBL:UPS:'+key,kind:'UPS',program:'UPS 250',ipo:'CHP-163',orderNumber:key,site:'Fictional '+key,customer:'UBL',grossContract:'900000',singleInvoiceSubmitted:false,singlePaymentReceived:false,delivered:false,installed:false,invoiceReferences:[],accountsReferences:[],...extra});
const snapshot=(rows:any[])=>({registers:[{rows}],cables:{rows:[]},internet:{rows:[]}});

test('programme source separates active/cancelled,50% entitlement,outstanding and settled-on-delivery positions',()=>{
 const rows=Array.from({length:10},(_,i)=>ups(`${i+1}/250`,{delivered:true,invoiceReferences:['I-'+i]}));rows[0].singlePaymentReceived=true;
 const cancelled=ups('11/250',{cancelled:true,cancellationOutcome:'Cancelled and reissued under12/250'});
 const projected=projectManagementProgrammes(snapshot([...rows,cancelled]),'2026-10-26',4),p=projected.programmes.find(p=>p.key==='ubl-ups-250')!;
 assert.equal(projected.sourceVersion,4);assert.equal(p.rows.length,10);assert.equal(p.cancelled.length,1);assert.equal(p.summary.active.amount,'9000000.00');
 assert.equal(p.summary.installationPending.amount,'4050000.00');assert.equal(p.summary.installationPending.receivedSites,1);assert.equal(p.summary.installationPending.receivedAmount,'450000.00');assert.equal(p.summary.advanceReceived.amount,'4500000.00');
 assert.equal(p.summary.paymentPending.sites,0,'uninstalled returned invoices never become payment-pending submitted');assert.deepEqual(p.summary.installationPending.siteKeys,rows.map(r=>r.key));
 assert.equal(p.cancelled[0].cancellationOutcome,'Cancelled and reissued under12/250');
});

test('programme partitions preserve MBL80/20/60 and exclude extra invoices,ambiguous invoice identities and unknown payment from submitted balances',()=>{
 const source:any=snapshot([
  ups('1/250',{installed:true,delivered:true,singleInvoiceSubmitted:true,invoiceReferences:['SYSTEM-1']}),
  ups('2/250',{installed:true,singleInvoiceSubmitted:true,invoiceReferences:['CABLE-2']}),
  ups('3/250',{installed:true,singleInvoiceSubmitted:true,invoiceReferences:['INTERNET-3']}),
  ups('4/250',{installed:true,singleInvoiceSubmitted:true,invoiceReferences:['SHARED']}),ups('5/250',{installed:true,singleInvoiceSubmitted:true,invoiceReferences:['SHARED']}),
  ups('6/250',{installed:true,singleInvoiceSubmitted:true,singlePaymentReceived:null,invoiceReferences:['SYSTEM-6']}),
  ...[80,20,60].map(n=>ups('1/'+n,{key:'MBL:UPS:1/'+n,customer:'MBL',program:'MBL UPS '+n,ipo:'MBL-'+n,grossContract:'660000',remainingFraction:1,advanceReceivedFraction:0})),
 ]);source.cables.rows=[{invoice:'CABLE-2'}];source.internet.rows=[{invoice:'INTERNET-3'}];
 const data=projectManagementProgrammes(source,'2026-10-26',1),ubl=data.programmes.find(p=>p.key==='ubl-ups-250')!;
 assert.equal(ubl.summary.paymentPending.sites,1);assert.equal(ubl.summary.paymentPending.amount,'450000.00');assert.equal(ubl.summary.installed.amount,'2700000.00');assert.ok(ubl.rows.find(r=>r.orderNumber==='6/250')!.flags.some(f=>f.includes('unverified')));
 for(const n of [80,20,60]){const p=data.programmes.find(p=>p.key==='mbl-ups-'+n)!;assert.equal(p.summary.active.sites,1);assert.equal(p.summary.pendingDelivery.amount,'660000.00');assert.equal(p.summary.advanceReceived.amount,'0.00');}
 assert.equal(data.programmes.find(p=>p.key==='all-ups')!.summary.active.sites,9);
});

test('solar uses recorded milestone amounts,partial coverage and accepted completion submission only',()=>{
 const s:any=snapshot([{key:'UBL:SOLAR:1/70',kind:'Solar / BESS',program:'Solar 70',grossContract:'1000',delivered:true,solarDelivered:true,installed:true,invoiceReferences:['SOLAR-1'],advance:{expected:'500',invoiceAmount:'500',received:true,submitted:true},completion:{expected:'500',invoiceAmount:'480',outstandingAmount:'280',submitted:true,received:false}},
 {key:'UBL:SOLAR:2/70',kind:'Solar / BESS',program:'Solar 70',grossContract:null,delivered:true,installed:false,invoiceReferences:['SOLAR-2'],advance:{expected:null,invoiceAmount:null,submitted:false,received:false},completion:{expected:null,invoiceAmount:'500',submitted:true,received:false}}]);
 const p=projectManagementProgrammes(s,'2026-10-26',1).programmes[0];
 assert.equal(p.summary.active.amount,'1000.00');assert.equal(p.summary.active.missingSites,1);assert.equal(p.milestones!.completion.submitted.sites,1);assert.equal(p.milestones!.completion.pending.amount,'280.00');assert.equal(p.milestones!.advance.received.amount,'500.00');assert.equal(p.milestones!.advance.toSubmit.amount,null);
 assert.throws(()=>projectManagementProgrammes(snapshot([ups('1/250'),ups('1/250')]),'2026-10-26',1),/duplicated/);
});

test('Accounts programme HTTP is read-only,source-versioned and denies other roles without changing historical209import',async()=>{
 const db=await testDatabase();try{
  const users:Record<string,string>={},cookies:Record<string,string>={};for(const role of ['Admin','Management','Accounts','Inventory','Operations','Coordinator']){const id=users[role]=randomUUID(),token=randomBytes(32).toString('base64url');await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);await db.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),id,randomUUID()]);cookies[role]='pz_session='+token;}
  await assert.rejects(managementProgrammes(db.pool,users.Management),/not been imported/);
  const source:any={...snapshot([ups('1/250',{installed:true,singleInvoiceSubmitted:true,invoiceReferences:['26-10001']})]),sourceDate:'2026-10-26',manifest:[{name:'fictional-source',sha256:'f'.repeat(64)}],evidence:{rows:[],cableStageAdjustments:[]},sites:{rows:[]}};
  await new AccountsSourceRegisters(db.pool).import(users.Admin,source,0);
  const protectedTables=['management_received_po_batches','accounts_source_registers','internal_purchase_orders','stock_on_hand_entries','accounts_job_closures'];
  const fingerprint=async()=>Object.fromEntries(await Promise.all(protectedTables.map(async table=>[table,(await db.pool.query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,'')) AS hash FROM ${table} r`)).rows[0].hash])));
  const before=await fingerprint(),app=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:'http://localhost:3000',DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'management-programme-isolated-setup-token'}));
  await request(app).get('/api/accounts-workspace/programmes').expect(401);
  for(const role of Object.keys(users)){const response=await request(app).get('/api/accounts-workspace/programmes').set('Cookie',cookies[role]);assert.equal(response.status,['Admin','Management','Accounts'].includes(role)?200:403,role);if(response.status===200){assert.match(response.headers['cache-control'],/no-store/);assert.equal(response.body.sourceVersion,1);assert.equal(response.body.programmes[1].summary.active.sites,1);}}
  assert.deepEqual(await fingerprint(),before);
  const historical=(await db.pool.query('SELECT snapshot FROM management_received_po_batches ORDER BY imported_at DESC LIMIT 1')).rows[0].snapshot;assert.equal(historical.rows.filter((r:any)=>r.customer==='UBL').length,209);
 }finally{await db.close();}
});


test('genuinely new post-cutoff sales append once at immutable approved values while historical collisions and imports stay held',()=>{
 const a=ups('1/250',{invoiceReferences:['OLD-INVOICE'],po:'OLD-PO'}),snapshotSource=snapshot([a]);
 const fresh={id:'new-ipo',recordId:'record-new',customer:'UBL',number:'CHP-163',orderNumber:'2/250',site:'Fictional new branch',siteCode:'F2',configuration:'6-10',poReference:'NEW-PO',grossContract:'987654.32',issuedAt:'2026-10-27T09:00:00Z'};
 const existing={...fresh,id:'historical',orderNumber:'1/250',poReference:'OLD-PO',historicalImport:true,sourceKey:a.key};
 const collision={...fresh,id:'reissued-review',orderNumber:'1/250',poReference:'DIFFERENT-PO'};
 const imported={...fresh,id:'unlinked-import',orderNumber:'3/250',historicalImport:true};
 const old={...fresh,id:'old-ipo',orderNumber:'4/250',issuedAt:'2026-10-25T09:00:00Z'};
 const added=appendIssuedProgrammeSales(snapshotSource,[fresh,fresh,existing,collision,imported,old],'2026-10-26'),d=projectManagementProgrammes(added.snapshot,'2026-10-26',1),p=d.programmes[1];
 assert.equal(p.rows.length,2);assert.equal(p.summary.active.amount,'1887654.32');const newRow=p.rows.find(r=>r.key==='issued:new-ipo')!;assert.equal(newRow.grossContract,'987654.32');assert.equal(newRow.recordKey,'ipo:new-ipo');assert.equal(newRow.advanceReceived,null);assert.equal(newRow.remainingPayable,null);assert.equal(newRow.paymentReceived,null);assert.equal(newRow.invoiceSubmitted,false);assert.equal(added.issues.length,3);
 const missing=appendIssuedProgrammeSales(snapshotSource,[{...fresh,grossContract:undefined}],'2026-10-26'),unknown=projectManagementProgrammes(missing.snapshot,'2026-10-26',1).programmes[1];assert.equal(unknown.summary.active.missingSites,1);assert.equal(unknown.summary.active.amount,'900000.00');
 const duplicateOrder=appendIssuedProgrammeSales(snapshotSource,[fresh,{...fresh,id:'second-id'}],'2026-10-26');assert.equal(projectManagementProgrammes(duplicateOrder.snapshot,'2026-10-26',1).programmes[1].rows.length,1);assert.equal(duplicateOrder.issues.length,2);
});


test('frozen cancellation outcomes require exact full source identity and original PO; reviewed replacement and reasons win',()=>{
 const rows=[ups('54/250',{cancelled:true,po:'POF252630626'}),ups('55/250',{cancelled:true,po:'CHANGED-PO'}),ups('19/250',{cancelled:true,po:''}),ups('154/250',{cancelled:false,po:'POF262704406'}),ups('159/250',{cancelled:true,po:'POF262704860',replacement:{verified:'2026-10-26',replacementOrder:'189/250',replacementPo:'VERIFIED-PO',sourceRows:[355,385]}}),ups('36/250',{key:'MBL:UPS:36/250',customer:'MBL',program:'MBL UPS 80',cancelled:true,po:'POF252629300'}),{key:'UBL:SOLAR:300',kind:'Solar / BESS',program:'Solar 70',cancelled:true,cancellationReason:'Landlord issue',po:'SOLAR-PO'}];
 const data=projectManagementProgrammes(snapshot(rows),'2026-10-26',1),ubl=data.programmes[1],byOrder=(order:string)=>ubl.cancelled.find(r=>r.orderNumber===order)!;
 assert.equal(byOrder('54/250').cancellationOutcome,'Abbot Road appears again under active order 173/250, PO POF262707685. Replacement link needs confirmation.');
 assert.ok(byOrder('54/250').sources.some(r=>r.sourceSha256==='67904c40ae03a22e4eb0040cb56feb9328d6127c1515ad8d7c8b67ebefcd7856'));
 for(const order of ['55/250','19/250']){assert.match(byOrder(order).cancellationOutcome!,/Outcome held/);assert.ok(byOrder(order).flags.some(f=>f.includes('requires review')));}
 assert.equal(ubl.rows.find(r=>r.orderNumber==='154/250')!.cancellationOutcome,null);
 assert.equal(byOrder('159/250').cancellationOutcome,'Reissued as active order 189/250 · PO VERIFIED-PO.');
 assert.equal(data.programmes[2].cancelled[0].cancellationOutcome,'Outcome not recorded in reviewed source.');
 assert.equal(data.programmes[0].cancelled[0].cancellationOutcome,'Landlord issue');
});
