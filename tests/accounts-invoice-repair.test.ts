import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {testDatabase} from './database.js';
import {AccountsSourceRegisters} from '../server/accounts/source-registers.js';
import {paymentRegisterData} from '../server/accounts/payment-records.js';
import {correctInvoice,amountRule} from '../server/accounts/invoice-corrections.js';
import {recordInvoiceReceipt} from '../server/accounts/invoice-receipts.js';
import {applyInvoiceCorrections} from '../server/accounts/invoice-correction-state.js';
import {invoiceDataReview,invoiceReviewGroup} from '../shared/accounts-invoice-review.js';
import {recoveryReport,recoveryFilteredRows} from '../shared/recovery-report.js';
import {isSubmittedInvoicePending} from '../shared/accounts-invoice-display.js';

test('amount-only entry keeps a known balance, uses recorded payments and never allocates an uncertain payment',()=>{
 assert.deepEqual(amountRule({pending:'400.00'},false),{rule:'kept',minimum:'400.00'});
 assert.deepEqual(amountRule({pending:null},false),{rule:'no-payments'});
 assert.deepEqual(amountRule({pending:'300.00',receiptVersion:2,operationalReceived:'200.00'},false),{rule:'from-receipts',minimum:'500.00'});
 assert.ok(amountRule({pending:null,invoiceAllocationPending:true,unallocatedStagePending:'900.00'},false).hold,'combined-invoice payment is not divided');
 assert.deepEqual(amountRule({pending:null,invoiceAllocationPending:true},true),{rule:'confirmed'},'an explicit PT balance may be confirmed');
 assert.ok(amountRule({pending:null,receiptConfirmed:true},false).hold,'an imported receipt needs the PT balance');
 const event=(snapshot:any)=>({source_row_id:'r',version:1,invoice_reference:'27-1',submitted_on:null,reason:'PT',changed_by:'S',created_at:'',snapshot:{originalInvoice:'27-1',customer:'C',sourceAmount:null,...snapshot}});
 const row={id:'r',invoice:'27-1',customer:'C',amount:null};
 assert.deepEqual(applyInvoiceCorrections([{...row,pending:'400.00'}],[event({confirmedAmount:'1000.00',outstandingRule:'kept',sourcePending:'400.00'})]).map(r=>[r.amount,r.pending]),[['1000.00','400.00']]);
 assert.deepEqual(applyInvoiceCorrections([{...row,pending:null}],[event({confirmedAmount:'1000.00',outstandingRule:'no-payments',sourcePending:null})]).map(r=>[r.amount,r.pending]),[['1000.00','1000.00']]);
 assert.deepEqual(applyInvoiceCorrections([{...row,pending:null}],[event({confirmedAmount:'1000.00',outstandingRule:'from-receipts',sourcePending:null})]).map(r=>[r.amount,r.pending]),[['1000.00',null]],'payments are applied afterwards from their frozen opening balance');
 assert.equal(invoiceReviewGroup({amount:null,pending:'4',submission:'Submitted'}),'balance-without-total');
 assert.equal(invoiceReviewGroup({amount:null,pending:null,submission:'Submitted'}),'missing-both');
 assert.equal(invoiceReviewGroup({amount:null,legacyStageId:'x'}),'split');
 assert.equal(invoiceReviewGroup({amount:'5',pending:'5'}),null);
});

test('existing records are repaired per invoice: Gojra split, known balances kept, receipts respected, totals agree',async()=>{
 const db=await testDatabase();try{
  const ids={Admin:randomUUID(),Accounts:randomUUID()};
  for(const [role,id]of Object.entries(ids))await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);
  // Historical UPS invoice with a known outstanding balance but no original total.
  const register={rows:[{key:'UBL:UPS:hist-1',site:'Historical balance site',ipo:'CHP-H1',kind:'UPS',program:'UBL UPS 250',installed:true,singleInvoiceSubmitted:true,invoiceReferences:['27-30001']}]};
  await new AccountsSourceRegisters(db.pool).import(ids.Admin,{sourceDate:'2026-10-29',manifest:[{name:'Isolated repair fixture',sha256:'d'.repeat(64)}],registers:[register],cables:{rows:[]},internet:{rows:[]},sites:{rows:[]},evidence:{rows:[{customer:'United Bank Limited',invoice:'27-30001',balance:'400.00',status:'submitted',date:'2026-09-01'}],cableStageAdjustments:[]}},0);
  // Historical submissions without amounts: Gojra combined, one plain, one later paid.
  const submission=async(site:string,reference:string)=>{const id=randomUUID();await db.pool.query("INSERT INTO accounts_invoice_submissions(id,source_kind,site_key,source_key,source_version,milestone,invoice_reference,submitted_on,snapshot,request,request_key,created_by) VALUES($1,'Operations',$2,$2,1,'delivery',$3,'2026-10-02',$4,'{}',$5,$6)",[id,site,reference,{site,ipo:'IPO-'+site,customer:'United Bank Limited',billingIds:[],invoiceReferences:reference.split(' / ')},randomUUID(),ids.Admin]);return id;};
  await submission('Gojra','27-10609 / 27-10609-S');await submission('Plain','27-40001');const paidId=await submission('Paid','27-50001');
  let reg=await paymentRegisterData(db.pool);const find=(invoice:string)=>reg.invoices.find((r:any)=>r.invoice===invoice)!;
  // A real-looking receipt recorded earlier against an invoice whose amount was unknown.
  const paid=find('27-50001');
  await recordInvoiceReceipt(db.pool,ids.Accounts,{sourceRowId:paid.id,sourceVersion:reg.sourceVersion,receiptVersion:0,amount:'200',outstandingBefore:'500',paymentDate:'2026-10-10',transactionId:'FIXTURE-TX-1',requestKey:randomUUID()});
  reg=await paymentRegisterData(db.pool);
  const review=invoiceDataReview(reg.invoices),count=(id:string)=>review.groups.find(g=>g.id===id)!.rows.map((r:any)=>r.invoice).sort();
  assert.deepEqual(count('split'),['27-10609','27-10609-S'],'Gojra is listed as two invoices, no duplicate combined row');
  assert.deepEqual(count('balance-without-total'),['27-30001','27-50001']);
  assert.deepEqual(count('missing-both'),['27-40001']);
  assert.equal(reg.invoices.filter((r:any)=>/27-10609/.test(r.invoice)).length,2);
  const receiptsBefore=(await db.pool.query('SELECT * FROM accounts_invoice_receipts ORDER BY id')).rows;
  const confirm=async(invoice:string,extra:any)=>{const r=find(invoice);return correctInvoice(db.pool,ids.Accounts,{sourceRowId:r.id,sourceVersion:reg.sourceVersion,version:r.correctionVersion??0,invoiceReference:r.invoice,submissionDate:r.date??null,reason:'Checked against PT invoice copy (fixture)',...extra,requestKey:randomUUID()});};
  // Gojra: each invoice keeps its own amount and the shared submission date.
  await confirm('27-10609',{confirmedAmount:'800000'});await confirm('27-10609-S',{confirmedAmount:'1250000.50'});
  // Known balance kept while the original total is entered.
  await assert.rejects(confirm('27-30001',{confirmedAmount:'300'}),/cannot be less than 400.00/);
  await confirm('27-30001',{confirmedAmount:'1000'});
  // Paid invoice: outstanding comes from the recorded payment, never re-entered.
  await assert.rejects(confirm('27-50001',{confirmedAmount:'600',confirmedOutstanding:'600'}),/enter only the invoice amount/);
  await assert.rejects(confirm('27-50001',{confirmedAmount:'400'}),/cannot be less than 500.00/);
  await confirm('27-50001',{confirmedAmount:'600'});
  await confirm('27-40001',{confirmedAmount:'700'});
  reg=await paymentRegisterData(db.pool);
  const state=(invoice:string)=>{const r=find(invoice);return [r.amount,r.pending,r.date,r.submission,!!r.receiptHold];};
  assert.deepEqual(state('27-10609'),['800000.00','800000.00','2026-10-02','Submitted',false]);
  assert.deepEqual(state('27-10609-S'),['1250000.50','1250000.50','2026-10-02','Submitted',false]);
  assert.deepEqual(state('27-30001'),['1000.00','400.00',state('27-30001')[2],'Submitted',false],'existing outstanding preserved');
  assert.deepEqual(state('27-50001'),['600.00','300.00','2026-10-02','Submitted',false],'500 opening balance less the 200 payment');
  assert.deepEqual(state('27-40001'),['700.00','700.00','2026-10-02','Submitted',false]);
  assert.equal(invoiceDataReview(reg.invoices).total,0,'nothing left to confirm in this fixture');
  assert.deepEqual((await db.pool.query('SELECT * FROM accounts_invoice_receipts ORDER BY id')).rows,receiptsBefore,'payments untouched');
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM accounts_invoice_submissions')).rows[0].n,3,'not resubmitted');
  // Accounts receivables, Management receivables (same billing endpoint) and recovery export agree.
  const billing=await new AccountsSourceRegisters(db.pool).billing(ids.Accounts);
  const pending=(rows:any[])=>rows.filter(isSubmittedInvoicePending).map(r=>[r.invoice,r.pending]).sort();
  assert.deepEqual(pending(billing.rows),pending(reg.awaiting));
  const report=recoveryReport(recoveryFilteredRows(reg.awaiting,{},reg.sourceVersion),'2026-11-03');
  const expected=pending(reg.awaiting).reduce((n,[,p])=>n.plus(p),new Decimal(0)).toFixed(2);
  assert.equal(report.total,expected);assert.equal(report.items.length,pending(billing.rows).length);assert.equal(report.unknownAmounts,0);
  assert.equal(expected,new Decimal('800000').plus('1250000.50').plus('400').plus('300').plus('700').toFixed(2));
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM audit_log WHERE action LIKE 'accounts.invoice-correction:%'")).rows[0].n,5);
 }finally{await db.close();}
});

test('the "Not recorded" filter finds invoices without an outstanding amount, on screen and in the recovery PDF',()=>{
 const rows=[{id:'a',invoice:'27-1',site:'A',customer:'C',pending:null,submission:'Submitted',date:'2026-10-01'},{id:'b',invoice:'27-2',site:'B',customer:'C',pending:'500.00',submission:'Submitted',date:'2026-10-01'},{id:'c',invoice:'27-3',site:'C',customer:'C',pending:null,receiptHold:'x',submission:'Submitted',date:'2026-10-01'}];
 assert.deepEqual(recoveryFilteredRows(rows,{amount:'missing'},1).map(r=>r.id),['a','c']);
 assert.deepEqual(recoveryFilteredRows(rows,{amount:'recorded'},1).map(r=>r.id),['b']);
 assert.deepEqual(recoveryFilteredRows(rows,{},1).map(r=>r.id),['a','b','c']);
 const report=recoveryReport(recoveryFilteredRows(rows,{amount:'missing'},1),'2026-11-03');
 assert.equal(report.unknownAmounts,2);assert.equal(report.total,'0.00');
});
