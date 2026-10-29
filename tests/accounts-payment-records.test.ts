import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {AccountsSourceRegisters} from '../server/accounts/source-registers.js';
import {paymentRegister,recordPayment} from '../server/accounts/payment-records.js';
import {paymentQueue} from '../shared/accounts-payment-queue.js';
import {readFile} from 'node:fs/promises';
import {billingRows} from '../server/accounts/billing-model.js';
import {accountsPageName} from '../shared/accounts-navigation.js';

test('old Accounts navigation links resolve to consolidated entry points',()=>{
 assert.equal(accountsPageName('Programme Dashboard'),'Project Tracking');
 assert.equal(accountsPageName('Project Sites'),'Project Tracking');
 assert.equal(accountsPageName('Invoicing'),'Invoices to Submit');
 assert.equal(accountsPageName('Receivables'),'My Workspace');
});
test('cable and Internet receipt queues require an explicit confirmed receipt',()=>{
 const cables={rows:[{key:'c',program:'UBL',sites:[],invoice:'27-50123',invoicedAmount:'100',pendingAmount:'0',notes:[]}]};
 const internet={rows:[{key:'i',invoice:'27-60123',amount:'100',pendingAmount:'0'}]};
 assert.equal(paymentQueue(billingRows([],cables,internet),[]).length,0);
 const evidence={rows:[{customer:'United Bank Limited',invoice:'27-50123',status:'paid'},{customer:'United Bank Limited',invoice:'27-60123',status:'paid'}]};
 assert.equal(paymentQueue(billingRows([],cables,internet,evidence),[]).length,2);
});
test('owner-authorized BESS migration grants current Accounts users only and audits once',async()=>{
 const db=await testDatabase();try{
  const ids={Admin:randomUUID(),Accounts:randomUUID(),Inventory:randomUUID(),Design:randomUUID()};
  for(const[role,id]of Object.entries(ids))await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role==='Admin'?'Abu Bakar Siddique':role,role,'isolated']);
  const sql=await readFile('migrations/147_accounts_bess_cost_access.sql','utf8');await db.pool.query(sql);await db.pool.query(sql);
  assert.deepEqual((await db.pool.query('SELECT user_id FROM restricted_cost_access')).rows.map(r=>r.user_id),[ids.Accounts]);
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM audit_log WHERE action LIKE 'accounts.bess-cost-access.granted:%'")).rows[0].n,1);
 }finally{await db.close();}
});

test('payment queue requires explicit receipt confirmation, not a zero or unknown balance',()=>{
 assert.deepEqual(paymentQueue([{id:'a',invoice:'one',pending:'0'},{id:'b',invoice:'two',receiptConfirmed:true},{id:'c',invoice:'three',receiptConfirmed:true}],[{source_row_id:'c'}]).map(r=>r.id),['b']);
});
test('payment transaction entry is permission checked, versioned, immutable and duplicate safe without financial reposting',async()=>{
 const db=await testDatabase();try{
  const ids={Admin:randomUUID(),Accounts:randomUUID(),Management:randomUUID(),Inventory:randomUUID()};
  for(const[role,id]of Object.entries(ids))await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);
  const source=new AccountsSourceRegisters(db.pool);
  await source.import(ids.Admin,{sourceDate:'2026-10-29',manifest:[{name:'Reviewed source',sha256:'b'.repeat(64)}],registers:[{rows:[{key:'UBL:UPS:1/250',site:'Example',customer:'UBL',ipo:'CHP-163',kind:'UPS',program:'UBL UPS 250',singlePaymentReceived:true,singleInvoiceSubmitted:true,invoiceReferences:['27-10123'],actualInvoiceAmount:'1000'}]}],cables:{rows:[]},internet:{rows:[]},sites:{rows:[]},evidence:{rows:[],cableStageAdjustments:[]}},0);
  const before=await source.billing(ids.Accounts),queue=await paymentRegister(db.pool,ids.Accounts);
  assert.equal(queue.pending.length,1);
  const input={sourceRowId:queue.pending[0].id,sourceVersion:queue.sourceVersion,transactionId:'BANK-123',paymentDate:'2026-10-28',requestKey:randomUUID()};
  await assert.rejects(recordPayment(db.pool,ids.Management,input),/recording access/);
  await assert.rejects(paymentRegister(db.pool,ids.Inventory),/Accounts access/);
  await assert.rejects(recordPayment(db.pool,ids.Accounts,{...input,sourceVersion:99}),/changed/);
  const saved=await recordPayment(db.pool,ids.Accounts,input);
  assert.equal((await recordPayment(db.pool,ids.Accounts,input)).id,saved.id);
  await assert.rejects(recordPayment(db.pool,ids.Accounts,{...input,transactionId:'OTHER'}),/Request key/);
  await assert.rejects(recordPayment(db.pool,ids.Accounts,{...input,requestKey:randomUUID()}),/already recorded/);
  assert.equal((await paymentRegister(db.pool,ids.Accounts)).pending.length,0);
  assert.deepEqual(await source.billing(ids.Accounts),before);
  await assert.rejects(db.pool.query('DELETE FROM accounts_payment_records WHERE id=$1',[saved.id]));
 }finally{await db.close();}
});
