import {test} from 'node:test';
import assert from 'node:assert/strict';
import {billingRows} from '../server/accounts/billing-model.js';
import {awaitingInvoicePayments} from '../server/accounts/invoice-receipt-state.js';
import {paymentQueue} from '../shared/accounts-payment-queue.js';
import {isSubmittedInvoicePending} from '../shared/accounts-invoice-display.js';
import {recoveryReport,recoveryFilteredRows} from '../shared/recovery-report.js';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {AccountsSourceRegisters} from '../server/accounts/source-registers.js';
import {paymentRegisterData} from '../server/accounts/payment-records.js';

const cable=(invoice:string,pendingAmount:string|null,extra:any={})=>({key:'UPS 250:'+invoice,program:'UPS 250',sites:[{site:'Fixture cable site',ipo:'CHP-1'}],invoice,invoicedAmount:'7484',pendingAmount,submission:'Submitted',notes:[],...extra});
const paid=(invoice:string)=>({customer:'United Bank Limited',invoice,status:'paid'});
const confirmed=(rows:any[])=>rows.map(r=>[r.invoice,r.receiptConfirmed]);

test('a receipt is confirmed when its own balance is zero or not loaded, as before',()=>{
 const rows=billingRows([],{rows:[cable('27-90010','0'),cable('27-90011',null),cable('27-90012','0',{paymentReceived:true})]},{rows:[{key:'i',invoice:'27-90013',amount:'100',pendingAmount:'0',submission:'Submitted'}]},{rows:[paid('27-90010'),paid('27-90011'),paid('27-90013')]});
 assert.deepEqual(confirmed(rows),[['27-90010',true],['27-90011',true],['27-90012',true],['27-90013',true]]);
 assert.equal(paymentQueue(rows,[]).length,4,'they wait for transaction details, not payment');
 assert.equal(rows.some(r=>r.receiptConflict),false);
});

test('an invoice with an outstanding balance is never shown as received, even if another payment shares its number',()=>{
 // Recovery lists a main-system payment under 27-10177; the cable invoice itself is unpaid.
 const evidence={rows:[paid('27-90177'),paid('27-90178')]};
 const rows=billingRows([],{rows:[cable('27-90177','7484'),cable('27-90179','2500',{paymentReceived:true})]},{rows:[{key:'i',invoice:'27-90178',amount:'5000',pendingAmount:'5000',submission:'Submitted'}]},evidence);
 assert.deepEqual(confirmed(rows),[['27-90177',false],['27-90179',false],['27-90178',false]]);
 for(const row of rows){
  assert.equal(isSubmittedInvoicePending(row),true,row.invoice+' is still owed');
  assert.match(row.notes,/not applied to this invoice/,'the conflicting receipt stays visible for review');
  assert.equal(row.receiptConflict,true);
 }
 assert.equal(paymentQueue(rows,[]).length,0,'not in Receipt details to confirm');
 const awaiting=awaitingInvoicePayments(rows,paymentQueue(rows,[]));
 assert.deepEqual(awaiting.map(r=>[r.invoice,r.pending]),[['27-90177','7484'],['27-90179','2500'],['27-90178','5000']]);
 assert.equal(recoveryReport(awaiting,'2026-11-04').total,'14984.00','outstanding totals include them');
});

test('Accounts awaiting payment, receivables and the recovery export agree on the unpaid cable invoice',async()=>{
 const db=await testDatabase();try{
  const ids={Admin:randomUUID(),Accounts:randomUUID()};
  for(const [role,id]of Object.entries(ids))await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);
  await new AccountsSourceRegisters(db.pool).import(ids.Admin,{sourceDate:'2026-10-29',manifest:[{name:'Isolated receipt-conflict fixture',sha256:'f'.repeat(64)}],registers:[{rows:[]}],cables:{rows:[cable('27-90177','7484')]},internet:{rows:[]},sites:{rows:[]},evidence:{rows:[paid('27-90177')],cableStageAdjustments:[]}},0);
  const reg=await paymentRegisterData(db.pool),billing=await new AccountsSourceRegisters(db.pool).billing(ids.Accounts);
  const owed=(rows:any[])=>rows.filter(isSubmittedInvoicePending).map(r=>[r.invoice,r.pending,!!r.receiptConfirmed]);
  assert.deepEqual(owed(reg.awaiting),[['27-90177','7484',false]]);
  assert.deepEqual(owed(billing.rows),owed(reg.awaiting));
  assert.equal(reg.pending.length,0,'nothing waits for transaction details');
  assert.equal(recoveryReport(recoveryFilteredRows(reg.awaiting,{},reg.sourceVersion),'2026-11-04').total,'7484.00');
 }finally{await db.close();}
});
