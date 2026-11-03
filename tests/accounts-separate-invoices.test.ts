import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {testDatabase} from './database.js';
import {AccountsSourceRegisters} from '../server/accounts/source-registers.js';
import {recordInvoiceEntry,invoiceRegister,recordInvoiceSubmission,invoiceEntrySchema} from '../server/accounts/invoice-entries.js';
import {recordInvoiceUpdate} from '../server/accounts/invoice-records.js';
import {paymentRegisterData} from '../server/accounts/payment-records.js';
import {recordInvoiceReceipt} from '../server/accounts/invoice-receipts.js';
import {applyInvoiceSubmissionBilling} from '../server/accounts/invoice-submission-state.js';

async function fixture(){
 const db=await testDatabase();
 const ids={Admin:randomUUID(),Accounts:randomUUID(),Management:randomUUID()};
 for(const [role,id]of Object.entries(ids))await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);
 await new AccountsSourceRegisters(db.pool).import(ids.Admin,{sourceDate:'2026-10-29',manifest:[{name:'Isolated fixture',sha256:'b'.repeat(64)}],registers:[{rows:[]}],cables:{rows:[]},internet:{rows:[]},sites:{rows:[]},evidence:{rows:[],cableStageAdjustments:[]}},0);
 const site='gojra-fixture';
 await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[site,ids.Admin]);
 await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Test','Isolated fixture',$3,$4)",[site,{name:'Gojra fixture',ipo:'IPO-G1',customer:'United Bank Limited',installation:true,invoiceOnDelivery:true,stage:'delivered',completed:false,documents:[]},randomUUID(),ids.Admin]);
 const base={sourceKind:'Operations' as const,siteKey:site,sourceVersion:1,milestone:'delivery' as const,entryDate:'2026-10-20',notes:''};
 return {db,ids,site,base};
}

test('one site milestone carries separate invoices, each with its own number, amount, type and submission',async()=>{
 const {db,ids,site,base}=await fixture();try{
  const panels=await recordInvoiceEntry(db.pool,ids.Accounts,{...base,ptReference:'27-10609-S',invoiceLabel:'Solar Panels',invoiceStage:'advance-delivery',amount:'1250000.50',requestKey:randomUUID()});
  const rest=await recordInvoiceEntry(db.pool,ids.Accounts,{...base,ptReference:'27-10609',invoiceLabel:'Remaining System',requestKey:randomUUID()});
  // Duplicate protection stays on the actual invoice number.
  await assert.rejects(recordInvoiceEntry(db.pool,ids.Accounts,{...base,ptReference:' 27-10609 ',requestKey:randomUUID()}),/already recorded/);
  assert.equal(invoiceEntrySchema.safeParse({...base,ptReference:'27-10609 / 27-10610',requestKey:randomUUID()}).success,false,'one invoice number per record');
  assert.equal(invoiceEntrySchema.safeParse({...base,ptReference:'27-10611',amount:'0',requestKey:randomUUID()}).success,false,'amount must be positive');
  let register=await invoiceRegister(db.pool,ids.Accounts),row=register.submissionQueues.delivery.find((r:any)=>r.key===site)!;
  assert.deepEqual(row.invoices.map((i:any)=>[i.reference,i.label,i.amount,i.stage]),[['27-10609-S','Solar Panels','1250000.50','advance-delivery'],['27-10609','Remaining System',null,'advance-delivery']]);
  assert.equal(row.missingAmounts,1,'missing amount stays flagged, never inferred');
  assert.equal(row.unsubmittedInvoices,2);

  // Amount entry without a payment; a change to a known amount needs a reason.
  await recordInvoiceUpdate(db.pool,ids.Accounts,{invoiceKey:'entry:'+rest.id,version:0,amount:'800000',requestKey:randomUUID()});
  await assert.rejects(recordInvoiceUpdate(db.pool,ids.Accounts,{invoiceKey:'entry:'+rest.id,version:1,amount:'850000',requestKey:randomUUID()}),/reason/);
  await assert.rejects(recordInvoiceUpdate(db.pool,ids.Management,{invoiceKey:'entry:'+rest.id,version:1,amount:'850000',reason:'x',requestKey:randomUUID()}),/recording access/);
  await recordInvoiceUpdate(db.pool,ids.Accounts,{invoiceKey:'entry:'+rest.id,version:1,amount:'850000',reason:'Corrected from PT invoice copy',requestKey:randomUUID()});
  await assert.rejects(recordInvoiceUpdate(db.pool,ids.Accounts,{invoiceKey:'entry:'+rest.id,version:1,amount:'900000',reason:'stale',requestKey:randomUUID()}),/updated/);
  // Delay reason; "Other" needs a note.
  await assert.rejects(recordInvoiceUpdate(db.pool,ids.Accounts,{invoiceKey:'entry:'+panels.id,version:0,delayReason:'other',requestKey:randomUUID()}),/note/);
  await recordInvoiceUpdate(db.pool,ids.Accounts,{invoiceKey:'entry:'+panels.id,version:0,delayReason:'physical-originals',requestKey:randomUUID()});
  for(const table of ['accounts_invoice_receipts','accounts_payment_records'])assert.equal((await db.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0,'amount entry records no payment');

  register=await invoiceRegister(db.pool,ids.Accounts);row=register.submissionQueues.delivery.find((r:any)=>r.key===site)!;
  assert.deepEqual(row.invoices.map((i:any)=>[i.reference,i.amount,i.delay?.label??null]),[['27-10609-S','1250000.50','Awaiting physical originals'],['27-10609','850000.00',null]]);
  assert.equal(row.invoices[0].amount,'1250000.50','delay update keeps the saved amount');

  // Submission is per invoice; with two invoices the invoice must be named.
  const submit={sourceKind:'Operations',siteKey:site,sourceVersion:1,milestone:'delivery',submissionDate:'2026-10-22'};
  await assert.rejects(recordInvoiceSubmission(db.pool,ids.Accounts,{...submit,requestKey:randomUUID()}),/Choose which invoice/);
  await recordInvoiceSubmission(db.pool,ids.Accounts,{...submit,invoiceEntryId:panels.id,requestKey:randomUUID()});
  await assert.rejects(recordInvoiceSubmission(db.pool,ids.Accounts,{...submit,invoiceEntryId:panels.id,requestKey:randomUUID()}),/already marked submitted/);
  await assert.rejects(recordInvoiceUpdate(db.pool,ids.Accounts,{invoiceKey:'entry:'+panels.id,version:1,delayReason:'qc-pictures',requestKey:randomUUID()}),/already submitted/);
  register=await invoiceRegister(db.pool,ids.Accounts);row=register.submissionQueues.delivery.find((r:any)=>r.key===site)!;
  assert.ok(row,'site stays in Invoices to Submit while one invoice is unsubmitted');
  assert.deepEqual(row.invoices.map((i:any)=>[i.reference,i.submittedOn]),[['27-10609-S','2026-10-22'],['27-10609',null]]);
  await recordInvoiceSubmission(db.pool,ids.Accounts,{...submit,submissionDate:'2026-10-25',invoiceEntryId:rest.id,requestKey:randomUUID()});
  assert.equal((await invoiceRegister(db.pool,ids.Accounts)).submissionQueues.delivery.some((r:any)=>r.key===site),false);

  // Accounts receivables, Awaiting Payment and recovery read the same invoice records.
  const sources=new AccountsSourceRegisters(db.pool),billing=await sources.billing(ids.Accounts),payments=await paymentRegisterData(db.pool);
  const mine=(rows:any[])=>rows.filter(r=>r.site==='Gojra fixture').map(r=>[r.invoice,r.amount,r.pending]).sort();
  assert.deepEqual(mine(billing.rows),[['27-10609','850000.00','850000.00'],['27-10609-S','1250000.50','1250000.50']]);
  assert.deepEqual(mine(payments.awaiting),mine(billing.rows),'Awaiting Payment and receivables agree');
  const total=(rows:any[])=>rows.filter(r=>r.site==='Gojra fixture').reduce((n,r)=>n.plus(r.pending),new Decimal(0)).toFixed(2);
  assert.equal(total(billing.rows),'2100000.50');assert.equal(total(payments.awaiting),'2100000.50');

  // A payment reduces only its own invoice and then locks that invoice's amount.
  const target=payments.awaiting.find((r:any)=>r.invoice==='27-10609')!;
  await recordInvoiceReceipt(db.pool,ids.Accounts,{sourceRowId:target.id,sourceVersion:payments.sourceVersion,receiptVersion:target.receiptVersion,amount:'50000',paymentDate:'2026-10-28',transactionId:'TX-FIXTURE-1',requestKey:randomUUID()});
  assert.deepEqual(mine((await sources.billing(ids.Accounts)).rows),[['27-10609','850000.00','800000.00'],['27-10609-S','1250000.50','1250000.50']]);
  await assert.rejects(recordInvoiceUpdate(db.pool,ids.Accounts,{invoiceKey:'entry:'+rest.id,version:2,amount:'900000',reason:'late change',requestKey:randomUUID()}),/recorded payments/);

  // Saved records stay immutable; audit trail kept.
  await assert.rejects(db.pool.query('UPDATE accounts_invoice_updates SET amount=1'));
  await assert.rejects(db.pool.query('DELETE FROM accounts_invoice_entries'));
  assert.ok((await db.pool.query("SELECT count(*)::int n FROM audit_log WHERE action LIKE 'accounts.invoice-update:%'")).rows[0].n>=3);
  for(const table of ['internal_purchase_orders','accounts_job_closures','stock_on_hand_entries'])assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n,0);
 }finally{await db.close();}
});

test('a separate submission without a recorded amount stays flagged and never claims a different register invoice',()=>{
 const rows=[{id:'UBL:SOLAR:9:advance',customer:'United Bank Limited',category:'System · advance',invoice:'27-20001',amount:'500.00',pending:'500.00',submission:'Not confirmed'}];
 const event=(id:string,ref:string,amount:string|null)=>({id,invoice_entry_id:randomUUID(),entry_amount:amount,entry_stage:'advance-delivery',source_key:'UBL:SOLAR:9',milestone:'delivery',invoice_reference:ref,submitted_on:'2026-10-01',snapshot:{customer:'United Bank Limited',billingIds:['UBL:SOLAR:9:advance'],site:'S',ipo:'I'}});
 const out=applyInvoiceSubmissionBilling(rows,[event('a','27-20001',null),event('b','27-20001-S',null)]);
 assert.equal(out.find(r=>r.id==='UBL:SOLAR:9:advance')!.submission,'Submitted','the matching number links to the register row');
 const extra=out.find(r=>r.id==='submission:b')!;assert.equal(extra.amount,null);assert.equal(extra.pending,null);assert.equal(extra.amountMissing,true);assert.equal(extra.category,'System · advance');
 assert.equal(rows[0].submission,'Not confirmed','input not mutated');
});

test('migration 166 keeps existing invoice records unchanged and their milestone protection intact',async()=>{
 const {mkdtemp,readdir,copyFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join,resolve}=await import('node:path'),{migrate}=await import('../server/db/migrate.js');
 const db=await testDatabase({skipMigrations:true}),before=await mkdtemp(join(tmpdir(),'pz-before-166-'));
 try{
  for(const f of await readdir('migrations'))if(f.endsWith('.sql')&&Number(f.slice(0,3))<166)await copyFile(join('migrations',f),join(before,f));
  await migrate(db.pool,before);
  const owner=randomUUID(),entry=randomUUID(),submission=randomUUID();
  await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,'legacy@example.test','Legacy','Accounts','isolated')",[owner]);
  await db.pool.query("INSERT INTO accounts_invoice_entries(id,source_kind,site_key,source_version,milestone,pt_reference,entry_date,notes,snapshot,request,request_key,created_by) VALUES($1,'Operations','gojra',1,'delivery','27-10609 / 27-10609-S','2026-10-01','Historical combined entry','{\"site\":\"Gojra\"}','{}',$2,$3)",[entry,randomUUID(),owner]);
  await db.pool.query("INSERT INTO accounts_invoice_submissions(id,source_kind,site_key,source_key,source_version,milestone,invoice_reference,submitted_on,snapshot,request,request_key,created_by) VALUES($1,'Operations','gojra','gojra',1,'delivery','27-10609 / 27-10609-S','2026-10-02','{}','{}',$2,$3)",[submission,randomUUID(),owner]);
  const rows=async()=>[(await db.pool.query('SELECT * FROM accounts_invoice_entries')).rows,(await db.pool.query('SELECT * FROM accounts_invoice_submissions')).rows];
  const saved=await rows();
  await migrate(db.pool,resolve('migrations'));
  const after=await rows();
  assert.deepEqual(after[0].map(({invoice_stage,invoice_label,amount,invoice_identity,...r}:any)=>{assert.deepEqual([invoice_stage,invoice_label,amount,invoice_identity],[null,null,null,null],'no amount or identity is invented');return r;}),saved[0]);
  assert.deepEqual(after[1].map(({invoice_entry_id,...r}:any)=>{assert.equal(invoice_entry_id,null);return r;}),saved[1]);
  await assert.rejects(db.pool.query("INSERT INTO accounts_invoice_submissions(id,source_kind,site_key,source_key,source_version,milestone,invoice_reference,submitted_on,snapshot,request,request_key,created_by) VALUES($1,'Operations','gojra','gojra',1,'delivery','again','2026-10-03','{}','{}',$2,$3)",[randomUUID(),randomUUID(),owner]),/duplicate key/,'legacy milestone submission stays one per milestone');
 }finally{await db.close();await rm(before,{recursive:true,force:true});}
});
