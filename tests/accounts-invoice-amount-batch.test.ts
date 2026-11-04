import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {testDatabase} from './database.js';
import {AccountsSourceRegisters} from '../server/accounts/source-registers.js';
import {paymentRegisterData} from '../server/accounts/payment-records.js';
import {correctInvoice} from '../server/accounts/invoice-corrections.js';
import {recordInvoiceReceipt} from '../server/accounts/invoice-receipts.js';
import {planInvoiceAmountBatch,previewInvoiceAmountBatch,applyInvoiceAmountBatch} from '../server/accounts/invoice-amount-batch.js';
import {recoveryReport,recoveryFilteredRows} from '../shared/recovery-report.js';
import {isSubmittedInvoicePending} from '../shared/accounts-invoice-display.js';

const ups=(key:string,customer:'UBL'|'MBL',program:string,ipo:string,site:string,invoice:string,extra:any={})=>({key,site,customer,ipo,kind:'UPS',program,installed:true,singleInvoiceSubmitted:true,invoiceReferences:[invoice],...extra});
const balance=(customer:'UBL'|'MBL',invoice:string,value:string)=>({customer:customer==='MBL'?'Meezan Bank Limited':'United Bank Limited',invoice,balance:value,status:'submitted',date:'2026-10-01'});

test('only verified standard invoices of the two confirmed programmes are proposed; everything else is listed with a reason',()=>{
 const row=(id:string,extra:any)=>({id,invoice:id,site:'Site '+id,customer:'United Bank Limited',category:'System',sourceKey:'k-'+id,sourceKeys:['k-'+id],amount:null,pending:'100.00',submission:'Submitted',correctionVersion:0,...extra});
 const reg=(key:string,extra:any={})=>({key,site:'Site '+key.slice(2),customer:'UBL',kind:'UPS',program:'UPS 250',ipo:'CHP-163',...extra});
 const invoices=[row('a',{}),row('b',{customer:'Meezan Bank Limited'}),row('c',{customer:'Elahi Group',category:'Delivery only'}),row('d',{category:'Extra cable'}),row('e',{invoice:'27-1 / 27-2'}),row('f',{}),row('g',{}),row('h',{pending:'500000.00'}),row('i',{}),row('j',{}),row('j2',{invoice:'j'}),row('k',{amount:'450000.00'}),row('l',{}),row('m',{site:'Elsewhere'})];
 const registerRows=[reg('k-a'),reg('k-b',{customer:'MBL',program:'MBL UPS 80',configuration:'6 kW / 5 kWh'}),reg('k-f',{program:'UPS 60'}),reg('k-g',{ipo:'CHP-999'}),reg('k-h'),reg('k-i',{configuration:'6 kW / 5 kWh'}),reg('k-j'),reg('k-j2'),reg('k-k'),reg('k-m'),reg('k-e')];
 const plan=planInvoiceAmountBatch({invoices,receipts:[],sourceVersion:3},registerRows);
 assert.deepEqual(plan.eligible.map(r=>[r.rowId,r.proposedAmount,r.outstanding]),[['a','450000.00','100.00'],['b','660000.00','100.00']]);
 const reasons=Object.fromEntries(plan.skipped.map(s=>[s.rowId,s.kind+': '+s.reason]));
 assert.match(reasons.c,/^skipped: Not a confirmed customer/,'Elahi delivery-only invoices are excluded');
 assert.match(reasons.d,/^skipped: Not a standard UPS system invoice/,'extra-cable invoices are excluded');
 assert.match(reasons.e,/^exception: Combined/);
 assert.match(reasons.f,/^skipped: Other programme \(UPS 60\)/);
 assert.match(reasons.g,/^exception: Programme IPO is CHP-999/);
 assert.match(reasons.h,/^exception: Outstanding plus recorded payments \(500000.00\) exceed/,'never forces an amount below the kept balance');
 assert.match(reasons.i,/^exception: Register configuration differs/);
 assert.match(reasons.j,/^exception: Another invoice record uses the same invoice number/);
 assert.match(reasons.l,/^exception: No single register record/);
 assert.match(reasons.m,/^exception: Invoice site does not match/);
 assert.equal(reasons.k,undefined,'an amount already entered is not in the review group and is never touched');
 assert.equal(plan.total,'1110000.00');assert.match(plan.reference,/^UPS-AMT-[0-9A-F]{10}$/);
});

test('bulk fill applies owner-confirmed amounts once, keeps balances, payments and submissions, and every total still agrees',async()=>{
 const db=await testDatabase();try{
  const ids={Admin:randomUUID(),Accounts:randomUUID(),Coordinator:randomUUID()};
  for(const [role,id]of Object.entries(ids))await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);
  const rows=[
   ups('UBL:CHP-163:250 sites:1/250','UBL','UPS 250','CHP-163','UBL fixture one','27-91001'),
   ups('UBL:CHP-163:250 sites:2/250','UBL','UPS 250','CHP-163','UBL fixture two','27-91002'),
   ups('UBL:CHP-163:250 sites:3/250','UBL','UPS 250','CHP-163','UBL fixture paid in part','27-91003'),
   ups('UBL:CHP-163:250 sites:4/250','UBL','UPS 250','CHP-163','UBL fixture full contract balance','27-91004'),
   ups('UBL:CHP-163:250 sites:5/250','UBL','UPS 250','CHP-163','UBL fixture entered by Accounts','27-91005'),
   ups('MBL:CHP-220:62-site order:1/62','MBL','MBL UPS 80','CHP-220','MBL fixture one','26-92001'),
   ups('MBL:CHP-220:18 separately invoiced:1/18','MBL','MBL UPS 80','CHP-220','MBL fixture two','26-92002'),
   ups('MBL:CHP-338:60 sites:1/60','MBL','MBL UPS 60','CHP-338','MBL other programme','26-93001'),
  ];
  const evidence=[balance('UBL','27-91001','450000'),balance('UBL','27-91002','0'),balance('UBL','27-91003','450000'),balance('UBL','27-91004','900000'),balance('UBL','27-91005','450000'),balance('MBL','26-92001','660000'),balance('MBL','26-92002','660000'),balance('MBL','26-93001','660000')];
  const sources=new AccountsSourceRegisters(db.pool);
  await sources.import(ids.Admin,{sourceDate:'2026-11-04',manifest:[{name:'Isolated bulk amount fixture',sha256:'c'.repeat(64)}],registers:[{rows}],cables:{rows:[]},internet:{rows:[]},sites:{rows:[]},evidence:{rows:evidence,cableStageAdjustments:[]}},0);
  let reg=await paymentRegisterData(db.pool);const find=(invoice:string)=>reg.invoices.find((r:any)=>r.invoice===invoice)!;
  // Existing work that must be preserved: a part payment and an amount Salaas already entered.
  const part=find('27-91003');await recordInvoiceReceipt(db.pool,ids.Accounts,{sourceRowId:part.id,sourceVersion:reg.sourceVersion,receiptVersion:0,amount:'100000',paymentDate:'2026-10-20',transactionId:'FIXTURE-TX-1',requestKey:randomUUID()});
  reg=await paymentRegisterData(db.pool);
  const salaas=find('27-91005');await correctInvoice(db.pool,ids.Accounts,{sourceRowId:salaas.id,sourceVersion:reg.sourceVersion,version:0,invoiceReference:salaas.invoice,submissionDate:salaas.date??null,reason:'Entered from PT',confirmedAmount:'455000',requestKey:randomUUID()});
  reg=await paymentRegisterData(db.pool);
  const owed=(list:any[])=>list.filter(isSubmittedInvoicePending).map(r=>[r.invoice,r.pending]).sort();
  const before={awaiting:owed(reg.awaiting),billing:owed((await sources.billing(ids.Accounts)).rows),receipts:(await db.pool.query('SELECT * FROM accounts_invoice_receipts ORDER BY id')).rows,submissions:(await db.pool.query('SELECT count(*)::int n FROM accounts_invoice_submissions')).rows[0].n,dates:reg.invoices.map((r:any)=>[r.invoice,r.date,r.submission]).sort(),recovery:recoveryReport(recoveryFilteredRows(reg.awaiting,{},reg.sourceVersion),'2026-11-04').total};

  await assert.rejects(previewInvoiceAmountBatch(db.pool,ids.Coordinator),/access required/);
  const preview=await previewInvoiceAmountBatch(db.pool,ids.Accounts);
  assert.deepEqual(preview.eligible.map(r=>[r.invoice,r.proposedAmount,r.outstanding]),[['27-91001','450000.00','450000.00'],['27-91002','450000.00','0.00'],['27-91003','450000.00','350000.00'],['26-92001','660000.00','660000.00'],['26-92002','660000.00','660000.00']]);
  assert.deepEqual(preview.totals.map(t=>[t.count,t.total]),[[3,'1350000.00'],[2,'1320000.00']]);
  assert.equal(preview.total,'2670000.00');
  const why=Object.fromEntries(preview.skipped.map(s=>[s.invoice,s.kind]));
  assert.equal(why['27-91004'],'exception','a 900,000 balance is flagged, never accepted as the full contract');
  assert.equal(why['26-93001'],'skipped');assert.equal(why['27-91005'],undefined,'Salaas’s amount is not in the review group');

  // A change after review is caught; the reviewed list is what gets applied.
  await assert.rejects(applyInvoiceAmountBatch(db.pool,ids.Coordinator,{fingerprint:preview.fingerprint}),/access required/);
  const result=await applyInvoiceAmountBatch(db.pool,ids.Accounts,{fingerprint:preview.fingerprint});
  assert.deepEqual([result.reference,result.applied,result.alreadyApplied],[preview.reference,5,false]);
  const again=await applyInvoiceAmountBatch(db.pool,ids.Accounts,{fingerprint:preview.fingerprint});
  assert.deepEqual([again.applied,again.alreadyApplied],[5,true],'rerun is safe');
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM accounts_invoice_corrections WHERE snapshot->>'batchReference'=$1",[preview.reference])).rows[0].n,5);

  reg=await paymentRegisterData(db.pool);
  const state=(invoice:string)=>[find(invoice).amount,find(invoice).pending==null?null:new Decimal(find(invoice).pending).toFixed(2)];
  assert.deepEqual(state('27-91001'),['450000.00','450000.00']);
  assert.deepEqual(state('27-91002'),['450000.00','0.00'],'a zero balance stays zero');
  assert.deepEqual(state('27-91003'),['450000.00','350000.00'],'the part payment still counts');
  assert.deepEqual(state('26-92001'),['660000.00','660000.00']);
  assert.deepEqual(state('27-91005'),['455000.00','450000.00'],'Salaas’s amount is not overwritten');
  assert.deepEqual(state('27-91004'),[null,'900000.00'],'the exception is left for review');
  assert.deepEqual(owed(reg.awaiting),before.awaiting,'outstanding balances unchanged');
  assert.deepEqual(owed((await sources.billing(ids.Accounts)).rows),before.billing,'Accounts and Management receivables unchanged');
  assert.equal(recoveryReport(recoveryFilteredRows(reg.awaiting,{},reg.sourceVersion),'2026-11-04').total,before.recovery,'recovery PDF total unchanged');
  assert.deepEqual((await db.pool.query('SELECT * FROM accounts_invoice_receipts ORDER BY id')).rows,before.receipts,'payments untouched');
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM accounts_invoice_submissions')).rows[0].n,before.submissions,'nothing resubmitted');
  assert.deepEqual(reg.invoices.map((r:any)=>[r.invoice,r.date,r.submission]).sort(),before.dates,'submission dates and statuses unchanged');
  const billingRows=(await sources.billing(ids.Accounts)).rows;assert.equal(billingRows.find((r:any)=>r.invoice==='27-91001').amount,'450000.00','receivables show the filled amount');

  const batch=(await db.pool.query('SELECT * FROM accounts_invoice_amount_batches')).rows;
  assert.equal(batch.length,1);assert.equal(batch[0].before_state.eligible.length,5);assert.equal(batch[0].before_state.eligible[0].currentAmount,null);assert.match(batch[0].basis,/remaining balance invoice/);
  await assert.rejects(db.pool.query('UPDATE accounts_invoice_amount_batches SET basis=basis'),/immutable|cannot|not allowed/i);
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM audit_log WHERE action LIKE 'accounts.invoice-amount-batch:%'")).rows[0].n,1);

  const after=await previewInvoiceAmountBatch(db.pool,ids.Accounts);
  assert.equal(after.eligible.length,0);assert.equal(after.batches.length,1);
  await assert.rejects(applyInvoiceAmountBatch(db.pool,ids.Accounts,{fingerprint:after.fingerprint}),/No eligible/);
 }finally{await db.close();}
});

test('a list reviewed before records changed cannot be applied',async()=>{
 const db=await testDatabase();try{
  const admin=randomUUID(),accounts=randomUUID();
  for(const [role,id]of [['Admin',admin],['Accounts',accounts]])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);
  await new AccountsSourceRegisters(db.pool).import(admin,{sourceDate:'2026-11-04',manifest:[{name:'Isolated stale fixture',sha256:'d'.repeat(64)}],registers:[{rows:[ups('UBL:CHP-163:250 sites:1/250','UBL','UPS 250','CHP-163','UBL one','27-91001'),ups('UBL:CHP-163:250 sites:2/250','UBL','UPS 250','CHP-163','UBL two','27-91002')]}],cables:{rows:[]},internet:{rows:[]},sites:{rows:[]},evidence:{rows:[balance('UBL','27-91001','450000'),balance('UBL','27-91002','450000')],cableStageAdjustments:[]}},0);
  const preview=await previewInvoiceAmountBatch(db.pool,accounts);assert.equal(preview.eligible.length,2);
  const reg=await paymentRegisterData(db.pool),row=reg.invoices.find((r:any)=>r.invoice==='27-91002')!;
  await correctInvoice(db.pool,accounts,{sourceRowId:row.id,sourceVersion:reg.sourceVersion,version:0,invoiceReference:row.invoice,submissionDate:row.date??null,reason:'Entered from PT',confirmedAmount:'452000',requestKey:randomUUID()});
  await assert.rejects(applyInvoiceAmountBatch(db.pool,accounts,{fingerprint:preview.fingerprint}),/changed since this list was reviewed/);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM accounts_invoice_amount_batches')).rows[0].n,0);
 }finally{await db.close();}
});
