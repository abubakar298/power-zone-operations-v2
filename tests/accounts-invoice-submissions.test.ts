import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import request from 'supertest';
import {testDatabase} from './database.js';
import {AccountsSourceRegisters} from '../server/accounts/source-registers.js';
import {invoiceRegister,recordInvoiceSubmission,recordInvoiceEntry,invoiceSubmissionSchema} from '../server/accounts/invoice-entries.js';
import {managementProgrammes} from '../server/director/management-programmes.js';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import {digest} from '../server/auth/crypto.js';
import {applyInvoiceSubmissionBilling,applyInvoiceSubmissionStages,submissionBillingBasis} from '../server/accounts/invoice-submission-state.js';
async function fixture(){
 const db=await testDatabase(),ids:Record<string,string>={};
 for(const role of ['Admin','Accounts','Management','Inventory']){const id=ids[role]=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);}
 const ups={key:'UBL:UPS:1/250',kind:'UPS',program:'UPS 250',customer:'UBL',ipo:'CHP-163',orderNumber:'1/250',site:'Fictional UPS',delivered:true,installed:true,singleInvoiceSubmitted:false,singlePaymentReceived:false,invoiceReferences:['27-10001'],actualInvoiceAmount:'1000.25',grossContract:'2000.50'};
 const solar={key:'UBL:SOLAR:2',kind:'Solar / BESS',program:'Solar 70',customer:'UBL',ipo:'CHP-2',site:'Fictional solar',delivered:true,installed:true,invoiceReferences:['27-10002'],advance:{invoiceAmount:'500',outstandingAmount:'0',submitted:true,received:true,submissionEvidence:'2026-10-20'},completion:{invoiceAmount:'500',outstandingAmount:'123.45',submitted:false,received:false}};
 const snapshot={sourceDate:'2026-10-29',manifest:[{name:'Isolated source',sha256:'a'.repeat(64)}],registers:[{rows:[ups,solar]}],cables:{rows:[]},internet:{rows:[]},sites:{rows:[]},evidence:{rows:[{customer:'United Bank Limited',invoice:'27-10001',balance:'750.10',status:'unsubmitted'}],cableStageAdjustments:[]}};
 const source=new AccountsSourceRegisters(db.pool);await source.import(ids.Admin,snapshot,0);
 const input={sourceKind:'Source register' as const,siteKey:ups.key,sourceVersion:1,milestone:'completion' as const,submissionDate:'2026-10-29',requestKey:randomUUID()};
 return {...db,ids,source,input,snapshot};
}
const financial=(rows:any[])=>rows.map(({id,invoice,amount,pending,receiptConfirmed}:any)=>({id,invoice,amount,pending,receiptConfirmed}));
test('actual submission updates queue, Management and receivable ageing; all existing money, references and tables preserved',async()=>{
 const f=await fixture();try{
  const before=await f.source.billing(f.ids.Accounts),sourceBefore=(await f.pool.query('SELECT snapshot FROM accounts_source_registers')).rows;
  const tables=(await f.pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN('accounts_invoice_submissions','audit_log') ORDER BY tablename")).rows.map(r=>r.tablename);
  const fingerprints=async()=>Promise.all(tables.map(async t=>[t,(await f.pool.query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,'')) h FROM ${t} r`)).rows[0].h]));
  const protectedBefore=await fingerprints();assert.equal((await invoiceRegister(f.pool,f.ids.Accounts)).submissionQueues.completion.length,2);
  const saved=await recordInvoiceSubmission(f.pool,f.ids.Accounts,f.input,new Date('2026-10-30T01:00:00Z'));assert.equal(saved.invoice_reference,'27-10001');assert.equal(saved.submitted_on,'2026-10-29');
  const after=await f.source.billing(f.ids.Management,new Date('2026-10-30T01:00:00Z'));assert.deepEqual(financial(after.rows),financial(before.rows));
  const bill=after.rows.find(r=>r.invoice==='27-10001')!;assert.equal(bill.pending,'750.10');assert.equal(bill.submission,'Submitted');assert.equal(bill.date,'2026-10-29');assert.equal(bill.band,'0-7');
  assert.equal((await invoiceRegister(f.pool,f.ids.Accounts)).submissionQueues.completion.length,1);
  const programme=(await managementProgrammes(f.pool,f.ids.Management)).programmes[1];assert.equal(programme.rows[0].invoiceSubmitted,true);assert.equal(programme.rows[0].paymentReceived,false);
  assert.deepEqual((await f.pool.query('SELECT snapshot FROM accounts_source_registers')).rows,sourceBefore);assert.deepEqual(await fingerprints(),protectedBefore);
 }finally{await f.close();}
});
test('request replay and concurrent double clicks save once; duplicate or changed requests cannot overwrite date/reference',async()=>{
 const f=await fixture();try{
  const [a,b]=await Promise.all([recordInvoiceSubmission(f.pool,f.ids.Accounts,f.input),recordInvoiceSubmission(f.pool,f.ids.Accounts,f.input)]);assert.equal(a.id,b.id);
  await assert.rejects(recordInvoiceSubmission(f.pool,f.ids.Accounts,{...f.input,submissionDate:'2026-10-28'}),/Request key/);
  await assert.rejects(recordInvoiceSubmission(f.pool,f.ids.Accounts,{...f.input,requestKey:randomUUID()}),/already marked/);
  await assert.rejects(f.pool.query("UPDATE accounts_invoice_submissions SET submitted_on='2026-10-28' WHERE id=$1",[a.id]));
  await assert.rejects(f.pool.query('DELETE FROM accounts_invoice_submissions WHERE id=$1',[a.id]));
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM accounts_invoice_submissions')).rows[0].n,1);
 }finally{await f.close();}
});
test('actual dates, role, source version and immutable invoice creation are required',async()=>{
 const f=await fixture();try{
  for(const role of ['Management','Inventory'])await assert.rejects(recordInvoiceSubmission(f.pool,f.ids[role],f.input),/access/);
  await assert.rejects(recordInvoiceSubmission(f.pool,f.ids.Accounts,{...f.input,submissionDate:'2030-01-01'}),/future/);
  await assert.rejects(recordInvoiceSubmission(f.pool,f.ids.Accounts,{...f.input,submissionDate:''}));
  await assert.rejects(recordInvoiceSubmission(f.pool,f.ids.Accounts,{...f.input,sourceVersion:2}),/changed/);
  assert.equal(invoiceSubmissionSchema.safeParse({...f.input,ptReference:'CHANGED',pending:'0'}).success,false);
  const site='native-created';await f.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[site,f.ids.Accounts]);
  await f.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Fixture','isolated',$3,$4)",[site,{name:'Fictional delivery',ipo:'IPO-NATIVE',customer:'Fictional customer',projectType:'delivery-only',installation:false,stage:'delivered',completed:true},randomUUID(),f.ids.Accounts]);
  const input={...f.input,sourceKind:'Operations' as const,siteKey:site,milestone:'delivery' as const,requestKey:randomUUID()};
  await assert.rejects(recordInvoiceSubmission(f.pool,f.ids.Accounts,input),/Record the invoice/);
  const invoice=await recordInvoiceEntry(f.pool,f.ids.Accounts,{sourceKind:'Operations',siteKey:site,sourceVersion:1,milestone:'delivery',ptReference:'PT-NATIVE-1',entryDate:'2026-10-28',notes:'Existing PT reference',requestKey:randomUUID()});
  await assert.rejects(recordInvoiceSubmission(f.pool,f.ids.Accounts,{...input,submissionDate:'2026-10-27'}),/before.*invoice date/);
  const saved=await recordInvoiceSubmission(f.pool,f.ids.Accounts,input);assert.equal(saved.invoice_reference,'PT-NATIVE-1');
  const after=await f.source.billing(f.ids.Management),native=after.rows.find(r=>r.id==='submission:'+saved.id)!;assert.equal(native.pending,null);assert.equal(native.amount,null);
  assert.equal((await f.pool.query('SELECT pt_reference FROM accounts_invoice_entries WHERE id=$1',[invoice.id])).rows[0].pt_reference,'PT-NATIVE-1');
 }finally{await f.close();}
});
test('Solar completion submission keeps delivery submission, received advance and outstanding balance unchanged',async()=>{
 const f=await fixture();try{
  const before=await f.source.billing(f.ids.Accounts),input={...f.input,siteKey:'UBL:SOLAR:2'};
  await recordInvoiceSubmission(f.pool,f.ids.Accounts,input);const after=await f.source.billing(f.ids.Accounts);
  assert.deepEqual(financial(after.rows),financial(before.rows));assert.equal(after.rows.find(r=>r.id==='UBL:SOLAR:2:advance')!.date,'2026-10-20');
  assert.equal(after.rows.find(r=>r.id==='UBL:SOLAR:2:completion')!.pending,'123.45');assert.equal(after.rows.find(r=>r.id==='UBL:SOLAR:2:completion')!.date,'2026-10-29');
  const programme=(await managementProgrammes(f.pool,f.ids.Management)).programmes[0];assert.equal(programme.milestones!.completion.submitted.sites,1);assert.equal(programme.milestones!.advance.received.sites,1);
 }finally{await f.close();}
});
test('HTTP submission enforces CSRF and never accepts replacement financial/reference fields',async()=>{
 const f=await fixture();try{
  const token=randomBytes(32).toString('base64url'),csrf=randomUUID();await f.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),f.ids.Accounts,csrf]);
  const app=createApp(f.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:'http://localhost:3000',DATABASE_URL:f.url,ADMIN_SETUP_TOKEN:'invoice-submission-isolated-test-setup-token'}));
  await request(app).post('/api/accounts-workspace/invoice-submissions').set('Origin','http://localhost:3000').set('Cookie','pz_session='+token).send(f.input).expect(403);
  await request(app).post('/api/accounts-workspace/invoice-submissions').set('Origin','http://localhost:3000').set('Cookie','pz_session='+token).set('X-CSRF-Token',csrf).send({...f.input,amount:'0'}).expect(400);
  const saved=await request(app).post('/api/accounts-workspace/invoice-submissions').set('Origin','http://localhost:3000').set('Cookie','pz_session='+token).set('X-CSRF-Token',csrf).send(f.input).expect(201);assert.equal(saved.body.invoice_reference,'27-10001');
 }finally{await f.close();}
});
test('reporting overlays do not mutate inputs and never claim unrelated financial rows',()=>{
 const rows=[{id:'system:A',customer:'A',invoice:'I-A',amount:'100.25',pending:'75.10',receiptConfirmed:false,submission:'Submission not confirmed',date:null},{id:'system:B',customer:'B',invoice:'I-B',amount:'80',pending:'70'}],events=[{id:'e',milestone:'completion',source_key:'key',invoice_reference:'I-A',submitted_on:'2026-10-29',snapshot:{customer:'A',billingIds:['system:A'],invoiceReferences:['I-A']}}];
 const before=JSON.stringify(rows),out=applyInvoiceSubmissionBilling(rows,events);assert.equal(JSON.stringify(rows),before);assert.equal(out[1],rows[1]);assert.equal(out[0].pending,'75.10');
 const source={registers:[{rows:[{key:'key',kind:'UPS',invoiceReferences:['OTHER'],singleInvoiceSubmitted:false}]}]};assert.equal(applyInvoiceSubmissionStages(source,events).registers[0].rows[0].singleInvoiceSubmitted,false);
 assert.equal(submissionBillingBasis({key:'native',customer:'UBL',invoiceReferences:['27-10001']},undefined,[{id:'system:United Bank Limited:27-10001',customer:'United Bank Limited',category:'System',invoice:'27-10001'}]).held,true);
});
