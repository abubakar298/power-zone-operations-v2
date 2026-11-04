import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {AccountsSourceRegisters} from '../server/accounts/source-registers.js';
import {paymentRegisterData} from '../server/accounts/payment-records.js';
import {correctInvoice,invoiceCorrectionSchema} from '../server/accounts/invoice-corrections.js';
import {recordInvoiceReceipt,invoiceReceiptSchema} from '../server/accounts/invoice-receipts.js';
import {invoiceMoney} from '../server/accounts/invoice-records.js';
import {applyInvoiceCorrections} from '../server/accounts/invoice-correction-state.js';

test('PKR amounts accept thousands commas; badly written amounts are refused instead of failing the request',()=>{
 const receipt={sourceRowId:'r',sourceVersion:1,receiptVersion:0,paymentDate:'2026-11-03',transactionId:'TX-1',requestKey:randomUUID()};
 assert.equal(invoiceReceiptSchema.parse({...receipt,amount:'1,250.50',outstandingBefore:'450,000'}).outstandingBefore,'450000');
 assert.equal(invoiceReceiptSchema.parse({...receipt,amount:'1,250.50'}).amount,'1250.50');
 for(const amount of ['abc','','0','4,5,,','4,5','45,00','1,2345','12.345','-5'])assert.equal(invoiceReceiptSchema.safeParse({...receipt,amount}).success,false,amount);
 assert.equal(invoiceMoney.parse('2,000,000'),'2000000');
 assert.equal(invoiceMoney.safeParse('two').success,false);
 const correction={sourceRowId:'r',sourceVersion:1,version:0,invoiceReference:'27-1',submissionDate:null,reason:'PT',requestKey:randomUUID()};
 assert.deepEqual([invoiceCorrectionSchema.parse({...correction,confirmedAmount:'1,000,000',confirmedOutstanding:'450,000'})].map(r=>[r.confirmedAmount,r.confirmedOutstanding]),[['1000000','450000']]);
});

test('existing amount confirmations are applied exactly as before',()=>{
 const event=(version:number,snapshot:any)=>({source_row_id:'r',version,invoice_reference:'27-1',submitted_on:null,reason:'PT',changed_by:'S',created_at:'',snapshot:{originalInvoice:'27-1',customer:'C',sourceAmount:null,sourcePending:null,...snapshot}});
 const row={id:'r',invoice:'27-1',customer:'C',amount:null,pending:null};
 const state=(events:any[])=>applyInvoiceCorrections([row],events).map(r=>[r.amount,r.pending,r.pendingBasis])[0];
 assert.deepEqual(state([event(1,{confirmedAmount:'1000.00',outstandingRule:'no-payments'})]),['1000.00','1000.00','Invoice amount; no payment recorded']);
 assert.deepEqual(state([event(1,{confirmedAmount:'1000.00',confirmedOutstanding:'600.00',outstandingRule:'confirmed'})]),['1000.00','600.00','Accounts confirmed against PT']);
 assert.deepEqual(state([event(1,{confirmedAmount:'1000.00',outstandingRule:'kept'})]),['1000.00',null,'Existing balance kept']);
});

test('a PT outstanding balance saved without a payment (amount received 0) loads the balance and records no payment',async()=>{
 const db=await testDatabase();try{
  const ids={Admin:randomUUID(),Accounts:randomUUID()};
  for(const [role,id]of Object.entries(ids))await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);
  await new AccountsSourceRegisters(db.pool).import(ids.Admin,{sourceDate:'2026-10-29',manifest:[{name:'Isolated zero-payment fixture',sha256:'e'.repeat(64)}],registers:[{rows:[]}],cables:{rows:[]},internet:{rows:[]},sites:{rows:[]},evidence:{rows:[],cableStageAdjustments:[]}},0);
  const submission=async(site:string,reference:string)=>{await db.pool.query("INSERT INTO accounts_invoice_submissions(id,source_kind,site_key,source_key,source_version,milestone,invoice_reference,submitted_on,snapshot,request,request_key,created_by) VALUES($1,'Operations',$2,$2,1,'completion',$3,'2026-10-02',$4,'{}',$5,$6)",[randomUUID(),site,reference,{site,ipo:'IPO-'+site,customer:'United Bank Limited',billingIds:[],invoiceReferences:[reference]},randomUUID(),ids.Admin]);};
  await submission('Eiffel fixture','27-90001');await submission('Second fixture','27-90002');
  let reg=await paymentRegisterData(db.pool);const find=(invoice:string)=>reg.invoices.find((r:any)=>r.invoice===invoice)!;
  assert.equal(find('27-90001').pending,null,'balance not loaded before');
  const outstandingOnly=(invoice:string,confirmedOutstanding:string)=>{const r=find(invoice);return correctInvoice(db.pool,ids.Accounts,{sourceRowId:r.id,sourceVersion:reg.sourceVersion,version:r.correctionVersion??0,invoiceReference:r.invoice,submissionDate:r.date??null,reason:'Outstanding balance confirmed from PT; no payment received.',confirmedOutstanding,requestKey:randomUUID()});};
  await assert.rejects(outstandingOnly('27-90001','0'),/current outstanding balance from PT/);
  await outstandingOnly('27-90001','450,000');
  reg=await paymentRegisterData(db.pool);
  const row=find('27-90001');
  assert.deepEqual([row.amount,row.pending,row.pendingBasis,row.receiptVersion??0],[null,'450000.00','Accounts confirmed against PT',0]);
  assert.ok(reg.awaiting.some((r:any)=>r.id===row.id),'still awaiting payment');
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM accounts_invoice_receipts')).rows[0].n,0,'no payment recorded');
  // Later, the invoice amount is confirmed on its own: the loaded balance is kept.
  await correctInvoice(db.pool,ids.Accounts,{sourceRowId:row.id,sourceVersion:reg.sourceVersion,version:row.correctionVersion,invoiceReference:row.invoice,submissionDate:row.date,reason:'Invoice amount from PT',confirmedAmount:'500,000',requestKey:randomUUID()});
  reg=await paymentRegisterData(db.pool);
  assert.deepEqual([find('27-90001').amount,find('27-90001').pending],['500000.00','450000.00']);
  // A real payment then starts from the loaded balance.
  const loaded=find('27-90001');
  await recordInvoiceReceipt(db.pool,ids.Accounts,{sourceRowId:loaded.id,sourceVersion:reg.sourceVersion,receiptVersion:loaded.receiptVersion??0,amount:'100,000',paymentDate:'2026-11-03',transactionId:'FIXTURE-TX-9',requestKey:randomUUID()});
  reg=await paymentRegisterData(db.pool);
  assert.equal(find('27-90001').pending,'350000.00');
  await assert.rejects(outstandingOnly('27-90001','300000'),/recorded payments/,'paid invoices take their balance from payments');
  // An outstanding balance above a known invoice amount is refused.
  const second=find('27-90002');
  await correctInvoice(db.pool,ids.Accounts,{sourceRowId:second.id,sourceVersion:reg.sourceVersion,version:0,invoiceReference:second.invoice,submissionDate:second.date,reason:'Invoice amount from PT',confirmedAmount:'1000',requestKey:randomUUID()});
  reg=await paymentRegisterData(db.pool);
  await assert.rejects(outstandingOnly('27-90002','1500'),/cannot exceed the invoice amount/);
  await outstandingOnly('27-90002','800');
  reg=await paymentRegisterData(db.pool);
  assert.deepEqual([find('27-90002').amount,find('27-90002').pending],['1000.00','800.00']);
 }finally{await db.close();}
});
