import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {AccountsSourceRegisters} from '../server/accounts/source-registers.js';
import {consolidateCableInvoices,submitConsolidatedCable} from '../server/accounts/cable-consolidations.js';
import {paymentRegisterData} from '../server/accounts/payment-records.js';
import {invoiceRegister} from '../server/accounts/invoice-entries.js';
test('consolidated cable invoice replaces only selected unpaid records, preserves source/history and stays created until actual submission',async()=>{
 const db=await testDatabase();try{
  const ids:Record<string,string>={};for(const role of ['Admin','Management','Accounts','Inventory']){ids[role]=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[ids[role],role.toLowerCase()+'@example.test',role,'isolated']);}
  const cable=(key:string,invoice:string,site:string,amount:string)=>({key,invoice,program:'MBL UPS',sites:[{site,ipo:'CHP-220'}],invoicedAmount:amount,pendingAmount:amount,submission:'Submitted',observations:[{submitted:true,submissionEvidence:'2026-06-15'}],notes:[]});
  const snapshot={sourceDate:'2026-10-31',manifest:[{name:'Owned isolated fixture',sha256:'a'.repeat(64)}],registers:[{rows:[{key:'MBL:one',customer:'MBL',kind:'UPS',ipo:'CHP-220',site:'First site',invoiceReferences:['26-20214','26-20215']}]}],cables:{rows:[cable('one','26-20214','First site','2850'),cable('two','26-20215','Second site','11000'),cable('retained','27-20123','Eight sites','35591'),cable('multan','27-20126','Multan Road','14854')]},internet:{rows:[]},sites:{rows:[]},evidence:{rows:[{customer:'Meezan Bank Limited',invoice:'26-20214',status:'submitted',date:'2026-06-15'}],cableStageAdjustments:[]}};
  const sources=new AccountsSourceRegisters(db.pool);await sources.import(ids.Admin,snapshot,0);
  const before=(await db.pool.query('SELECT snapshot FROM accounts_source_registers WHERE version=1')).rows[0].snapshot;
  const input={sourceVersion:1,sourceRowIds:['cable:one','cable:two'],invoice:'26-20214',invoiceDate:'2026-08-24',amount:'155949.51',reason:'Reviewed replacement invoice; created, not submitted.',file:{name:'consolidated.pdf',base64:Buffer.from('%PDF-1.4\noriginal fixture').toString('base64')},requestKey:randomUUID()};
  await assert.rejects(consolidateCableInvoices(db.pool,ids.Inventory,input),/Accounts access/);
  const saved=await consolidateCableInvoices(db.pool,ids.Management,input);assert.equal(saved.version,2);assert.equal((await consolidateCableInvoices(db.pool,ids.Management,input)).key,saved.key);
  let current=await paymentRegisterData(db.pool);assert.equal(current.invoices.length,3);assert.deepEqual(current.awaiting.map(r=>r.invoice).sort(),['27-20123','27-20126']);
  const merged=current.invoices.find(r=>r.invoice==='26-20214')!;assert.equal(merged.amount,'155949.51');assert.equal(merged.pending,'155949.51');assert.equal(merged.date,null);assert.equal(merged.receiptConfirmed,false);assert.equal(merged.submission,'Created — submission pending');
  const queue=await invoiceRegister(db.pool,ids.Accounts);assert.equal(queue.submissionQueues.extraCable.length,1);assert.equal(queue.submissionQueues.extraCable[0].invoiceCreated,true);
  assert.deepEqual((await db.pool.query('SELECT snapshot FROM accounts_source_registers WHERE version=1')).rows[0].snapshot,before);
  for(const table of ['accounts_invoice_receipts','accounts_payment_records','accounts_invoice_entries','stock_on_hand_entries'])assert.equal((await db.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);
  await assert.rejects(consolidateCableInvoices(db.pool,ids.Management,{...input,requestKey:randomUUID()}),/changed/);
  await assert.rejects(submitConsolidatedCable(db.pool,ids.Accounts,{sourceVersion:2,key:saved.key,submissionDate:'2026-08-23',requestKey:randomUUID()}),/before the invoice/);
  await submitConsolidatedCable(db.pool,ids.Accounts,{sourceVersion:2,key:saved.key,submissionDate:'2026-10-31',requestKey:randomUUID()});
  current=await paymentRegisterData(db.pool);assert.equal(current.awaiting.find(r=>r.invoice==='26-20214')?.pending,'155949.51');assert.equal(current.awaiting.find(r=>r.invoice==='26-20214')?.date,'2026-10-31');assert.equal((await invoiceRegister(db.pool,ids.Accounts)).submissionQueues.extraCable,undefined);
 }finally{await db.close();}
});
