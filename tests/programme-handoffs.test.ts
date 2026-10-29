import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyProgrammeHandoffs,programmeHandoffState,type ProgrammeHandoff} from '../server/director/programme-handoffs.js';
import {projectManagementProgrammes} from '../server/director/management-programmes.js';
const observation=(s:any={},extra:any={}):ProgrammeHandoff=>({site_id:'registered-UBL:UPS:1/250',created_at:'2026-10-30',snapshot:{stage:'received',installation:true,projectType:'ups',...s},fileIds:['signed','ack','variable'],receiving:[],variableIssued:false,...extra});
const row=(extra:any={})=>({key:'UBL:UPS:1/250',kind:'UPS',program:'UPS 250',customer:'UBL',site:'Fictional branch',ipo:'CHP-163',orderNumber:'1/250',delivered:false,installed:false,singleInvoiceSubmitted:false,singlePaymentReceived:true,invoiceReferences:[],...extra});
const source=(r:any):any=>({registers:[{rows:[r]}],cables:{rows:[]},internet:{rows:[]},evidence:{rows:[]}});
const projected=(r:any,o:ProgrammeHandoff[])=>applyProgrammeHandoffs(source(r),o).registers[0].rows[0];
const delivery={deliveryDate:'2026-10-28',signedDo:{id:'signed'},partial:false};
const qc={date:'2026-10-29',acknowledgement:{id:'ack'},checks:{mounting:true,electrical:true,testingTraining:true,signoff:true}};
test('scheduling or stage label alone never proves delivery; scheduled stays outstanding',()=>{
 const s=observation({stage:'delivered',dispatchDate:'2026-10-31'}),r=projected(row(),[s]);assert.equal(r.delivered,false);assert.equal(r.scheduled,true);
 const p=projectManagementProgrammes(source(r),'2026-10-26',3).programmes[1];assert.equal(p.summary.pendingDelivery.sites,1);assert.equal(p.summary.installationPending.sites,0);assert.equal(r.singlePaymentReceived,true);
});
test('customer DO requires exact site file; partial remains outstanding, upload date cannot invent delivery date',()=>{
 assert.equal(programmeHandoffState(observation({deliveries:[delivery]})).delivered,true);
 assert.equal(programmeHandoffState(observation({deliveries:[delivery]},{fileIds:[]})).delivered,false);
 const partial=projected(row(),[observation({deliveries:[{...delivery,partial:true}]})]);assert.equal(partial.partialDelivery,true);assert.equal(projectManagementProgrammes(source(partial),'2026-10-26',3).programmes[1].summary.pendingDelivery.sites,1);
 const received=programmeHandoffState(observation({},{receiving:[{partial:false,createdAt:'2026-10-30T00:00:00Z'}]}));assert.equal(received.delivered,true);assert.equal(received.deliveryDate,null);
});
test('QC needs acknowledgement, actual date, applicable checks and issued variable signoff',()=>{
 const s={completed:true,deliveries:[delivery],qcJob:qc};assert.equal(programmeHandoffState(observation(s)).installed,true);
 assert.equal(programmeHandoffState(observation(s,{variableIssued:true})).installed,false);
 assert.equal(programmeHandoffState(observation({...s,qcJob:{...qc,variableSignoff:{id:'variable'}}},{variableIssued:true})).installed,true);
 assert.equal(programmeHandoffState(observation(s,{variableIssued:true,variableSigned:true})).installed,true);
 for(const final of [{...qc,date:''},{...qc,acknowledgement:undefined},{...qc,checks:{...qc.checks,signoff:false}}])assert.equal(programmeHandoffState(observation({...s,qcJob:final})).installed,false);
 assert.equal(programmeHandoffState(observation({...s,installation:false})).installed,false);
});
test('historical truths and starting PO survive incomplete snapshots; explicit returns override delivery',()=>{
 const historical=row({delivered:true,installed:true,po:'VERIFIED-PO',deliveryDate:'2026-09-01'});const preserved=projected(historical,[observation()]);assert.equal(preserved.delivered,true);assert.equal(preserved.installed,true);assert.equal(preserved.po,'VERIFIED-PO');
 const returned=observation({stage:'received',deliveryReturns:[{scope:'full',recordedAt:'2026-10-29T00:00:00Z'}],deliveries:[]});const reset=projected(historical,[returned]);assert.equal(reset.delivered,false);assert.equal(reset.installed,false);assert.equal(reset.deliveryDate,null);assert.equal(reset.singlePaymentReceived,true);
 const partialReturn=projected(row({delivered:true}),[observation({stage:'awaiting',deliveryReturns:[{scope:'partial',recordedAt:'2026-10-29T00:00:00Z'}],deliveries:[delivery],deliveryRecordedAt:'2026-10-28T00:00:00Z'})]);assert.equal(partialReturn.delivered,false);assert.equal(partialReturn.partialDelivery,true);
});
test('identity matches never use shared names; duplicate exact links hold stages',()=>{
 const wrong=observation({sourceKey:'OTHER',name:'Fictional branch'},{site_id:'different'});assert.equal(projected(row(),[wrong]).delivered,false);
 const duplicate=projected(row(),[observation({deliveries:[delivery]}),observation({sourceKey:'UBL:UPS:1/250',deliveries:[delivery]},{site_id:'second'})]);assert.equal(duplicate.delivered,false);assert.match(duplicate.flags.join(' '),/Multiple Operations/);
 const issued=projected(row({key:'issued:uuid'}),[observation({origin:{ipoId:'uuid'},deliveries:[delivery]})]);assert.equal(issued.delivered,true);
});
test('invoice creation never means submitted, advance never means installed; input unchanged',()=>{
 const input=source(row({key:'issued:uuid',installed:true,singleInvoiceSubmitted:true,invoiceReferences:['27-10001'],invoiceDate:'2026-10-29'})),before=JSON.stringify(input),out=applyProgrammeHandoffs(input,[]);assert.equal(out.registers[0].rows[0].singleInvoiceSubmitted,false);assert.equal(JSON.stringify(input),before);
 input.evidence.rows.push({customer:'United Bank Limited',invoice:'27-10001',status:'submitted',date:'2026-10-28'});assert.equal(applyProgrammeHandoffs(input,[]).registers[0].rows[0].singleInvoiceSubmitted,true);
 const advance=projected(row(),[observation()]);assert.equal(advance.installed,false);assert.equal(advance.singlePaymentReceived,true);
});

test('confirmed historical submissions stay confirmed when old date metadata is incomplete',()=>{const old=row({singleInvoiceSubmitted:true,invoiceReferences:['27-10001']});const out=projected(old,[]);assert.equal(out.singleInvoiceSubmitted,true);assert.ok(out.flags.some((f:string)=>f.includes('submission date')));});

test('new confirmed Solar sale appends once; legacy imports and conflicting PO identities stay held',async()=>{
 const {appendIssuedProgrammeSales}=await import('../server/director/management-programmes.js');
 const sale={id:'solar-uuid',frameworkType:'ubl-solar',customer:'UBL',issuedAt:'2026-10-30T00:00:00Z',siteCode:'S01',site:'Fictional solar',poReference:'NEW-PO',number:'IPO-NEW',grossContract:'1000'};
 const original=source(row());const added=appendIssuedProgrammeSales(original,[sale],'2026-10-26');assert.equal(added.snapshot.registers.at(-1)!.rows.length,1);assert.equal(added.snapshot.registers.at(-1)!.rows[0].program,'Solar 70');
 assert.equal(appendIssuedProgrammeSales(original,[{...sale,historicalImport:true}],'2026-10-26').snapshot.registers.at(-1)!.rows.length,0);
 assert.equal(appendIssuedProgrammeSales(original,[sale,{...sale,id:'duplicate'}],'2026-10-26').snapshot.registers.at(-1)!.rows.length,0);
});

test('recorded PT invoice references attach by exact site key without implying bank submission',()=>{
 const out=applyProgrammeHandoffs(source(row({key:'issued:uuid'})),[observation({origin:{ipoId:'uuid'}},{site_id:'live-ipo:uuid'})],[{site_key:'live-ipo:uuid',pt_reference:'27-10001'},{site_key:'other',pt_reference:'27-99999'}]).registers[0].rows[0];
 assert.deepEqual(out.invoiceReferences,['27-10001']);assert.equal(out.singleInvoiceSubmitted,false);
});

test('database projection verifies same-site file metadata and latest version without loading files or posting records',async()=>{
 const {testDatabase}=await import('./database.js'),{randomUUID}=await import('node:crypto'),{latestProgrammeHandoffs}=await import('../server/director/programme-handoffs.js');
 const db=await testDatabase();try{
  const actor=randomUUID(),signed=randomUUID(),ack=randomUUID(),id='registered-UBL:UPS:1/250';
  await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Fictional Management','Management','isolated')",[actor,actor+'@example.test']);
  for(const site of [id,'other-site'])await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[site,actor]);
  for(const [file,site] of [[signed,id],[ack,'other-site']])await db.pool.query("INSERT INTO operations_board_files(id,site_id,filename,media_type,sha256,content,created_by) VALUES($1,$2,'signed.pdf','application/pdf',$3,$4,$5)",[file,site,file.replaceAll('-','').padEnd(64,'0'),Buffer.from('isolated fixture'),actor]);
  const s={stage:'delivered',projectType:'ups',installation:true,completed:true,deliveries:[{...delivery,signedDo:{id:signed}}],qcJob:{...qc,acknowledgement:{id:ack}}};
  await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Fixture','isolated',$3,$4)",[id,s,randomUUID(),actor]);
  const before=(await db.pool.query('SELECT count(*)::int n FROM stock_on_hand_entries')).rows[0].n;
  const observations=await latestProgrammeHandoffs(db.pool),actual=observations.find(o=>o.site_id===id)!;
  assert.deepEqual(actual.fileIds,[signed]);assert.equal(programmeHandoffState(actual).delivered,true);assert.equal(programmeHandoffState(actual).installed,false,'another site acknowledgement cannot complete this site');
  assert.equal(JSON.stringify(actual).includes('isolated fixture'),false);assert.equal((await db.pool.query('SELECT count(*)::int n FROM stock_on_hand_entries')).rows[0].n,before);
 }finally{await db.close();}
});

test('delivery-only sites do not wait for installation; delivery invoices remain pending submission',()=>{
 const r=projected(row(),[observation({installation:false,deliveries:[delivery]})]);const p=projectManagementProgrammes(source(r),'2026-10-26',3).programmes[1];
 assert.equal(r.installed,false);assert.equal(p.summary.installationPending.sites,0);assert.equal(p.summary.invoicePending.sites,1);
});
test('a later partial dispatch after a partial return cannot reuse the old final DO as full delivery',()=>{
 const s=programmeHandoffState(observation({stage:'awaiting',deliveryReturns:[{scope:'partial',recordedAt:'2026-10-29T00:00:00Z',priorDeliveries:[delivery]}],deliveries:[delivery,{...delivery,deliveryDate:'2026-10-30',partial:true}],deliveryRecordedAt:'2026-10-30T00:00:00Z'}));assert.equal(s.delivered,false);assert.equal(s.partialDelivery,true);
});
