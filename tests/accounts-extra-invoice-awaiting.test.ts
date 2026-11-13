import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {AccountsSourceRegisters} from '../server/accounts/source-registers.js';
import {recordInvoiceEntry,invoiceRegister,recordInvoiceSubmission,invoiceSiteForSubmission} from '../server/accounts/invoice-entries.js';
import {paymentRegisterData} from '../server/accounts/payment-records.js';
import {recordInvoiceReceipt} from '../server/accounts/invoice-receipts.js';

async function fixture(){
 const db=await testDatabase();
 const ids={Admin:randomUUID(),Accounts:randomUUID(),Operations:randomUUID()};
 for(const [role,id]of Object.entries(ids))await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);
 await new AccountsSourceRegisters(db.pool).import(ids.Admin,{sourceDate:'2026-10-29',manifest:[{name:'Isolated fixture',sha256:'c'.repeat(64)}],registers:[{rows:[]}],cables:{rows:[]},internet:{rows:[]},sites:{rows:[]},evidence:{rows:[],cableStageAdjustments:[]}},0);
 const site='awaiting-extra-fixture';
 await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[site,ids.Admin]);
 await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Test','Isolated fixture',$3,$4)",[site,{name:'Awaiting extra fixture',ipo:'IPO-AX1',customer:'United Bank Limited',installation:true,stage:'completed',completed:true,documents:[]},randomUUID(),ids.Admin]);
 const base={sourceKind:'Operations' as const,siteKey:site,sourceVersion:1,milestone:'completion' as const,entryDate:'2026-10-20',notes:''};
 return {db,ids,site,base};
}
const mine=(rows:any[])=>rows.filter(r=>r.site==='Awaiting extra fixture').map(r=>[r.invoice,r.amount,r.pending]).sort();

test('Awaiting payment: an extra invoice for a submitted, part-paid site uses the same route and leaves the paid invoice unchanged',async()=>{
 const {db,ids,site,base}=await fixture();try{
  // Current behaviour: once its only invoice is submitted, the site leaves Invoices to Submit.
  const first=await recordInvoiceEntry(db.pool,ids.Accounts,{...base,ptReference:'27-20001',amount:'500000',requestKey:randomUUID()});
  await recordInvoiceSubmission(db.pool,ids.Accounts,{sourceKind:'Operations',siteKey:site,sourceVersion:1,milestone:'completion',submissionDate:'2026-10-22',requestKey:randomUUID()});
  assert.equal((await invoiceRegister(db.pool,ids.Accounts)).submissionQueues.completion.some((r:any)=>r.key===site),false);
  let payments=await paymentRegisterData(db.pool);
  const awaiting=payments.awaiting.find((r:any)=>r.invoice==='27-20001')!;
  assert.ok(awaiting.submissionId,'a portal-submitted invoice knows its submission');
  await recordInvoiceReceipt(db.pool,ids.Accounts,{sourceRowId:awaiting.id,sourceVersion:payments.sourceVersion,receiptVersion:awaiting.receiptVersion,amount:'200000',paymentDate:'2026-10-28',transactionId:'TX-AX-1',requestKey:randomUUID()});

  // New: the site behind that invoice, the same shape as an Invoices to Submit row.
  const found=await invoiceSiteForSubmission(db.pool,ids.Accounts,awaiting.submissionId);
  assert.deepEqual([found.sourceKind,found.key,found.sourceVersion,found.milestone,found.recordingHeld],['Operations',site,1,'completion',undefined]);
  assert.deepEqual(found.invoices.map((i:any)=>[i.entryId,i.reference,i.submittedOn]),[[first.id,'27-20001','2026-10-22']]);
  await assert.rejects(invoiceSiteForSubmission(db.pool,ids.Accounts,randomUUID()),/not found/);

  // Saving uses recordInvoiceEntry unchanged: role, request key and number checks stay.
  const extra={...base,sourceVersion:found.sourceVersion,ptReference:'27-20002',invoiceLabel:'Extra work',amount:'75000',requestKey:randomUUID()};
  await assert.rejects(recordInvoiceEntry(db.pool,ids.Operations,{...extra,requestKey:randomUUID()}),/access required/);
  await assert.rejects(recordInvoiceEntry(db.pool,ids.Accounts,{...extra,ptReference:'27-20001',requestKey:randomUUID()}),/already recorded/);
  const saved=await recordInvoiceEntry(db.pool,ids.Accounts,extra);
  assert.equal((await recordInvoiceEntry(db.pool,ids.Accounts,extra)).id,saved.id,'same request key replays');

  // The extra invoice goes to Invoices to Submit; the part-paid invoice keeps its balance.
  const row=(await invoiceRegister(db.pool,ids.Accounts)).submissionQueues.completion.find((r:any)=>r.key===site)!;
  assert.deepEqual(row.invoices.map((i:any)=>[i.reference,i.submittedOn]).sort(),[['27-20001','2026-10-22'],['27-20002',null]]);
  payments=await paymentRegisterData(db.pool);
  assert.deepEqual(mine(payments.awaiting),[['27-20001','500000.00','300000.00']],'nothing new is awaiting payment until it is submitted');
  for(const table of ['accounts_payment_records'])assert.equal((await db.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM accounts_invoice_receipts')).rows[0].n,1,'existing receipt untouched');
 }finally{await db.close();}
});
