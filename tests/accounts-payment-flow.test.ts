import{test}from'node:test';
import assert from'node:assert/strict';
import{randomUUID,randomBytes}from'node:crypto';
import request from'supertest';
import{testDatabase}from'./database.js';
import{AccountsSourceRegisters}from'../server/accounts/source-registers.js';
import{invoiceRegister,recordInvoiceEntry,recordInvoiceSubmission}from'../server/accounts/invoice-entries.js';
import{paymentRegister}from'../server/accounts/payment-records.js';
import{recordInvoiceReceipt}from'../server/accounts/invoice-receipts.js';
import{applyInvoiceReceipts,awaitingInvoicePayments,applyReceiptProgramme}from'../server/accounts/invoice-receipt-state.js';
import{OperationsBoardRepository}from'../server/operations-board/repository.js';
import{managementProgrammes}from'../server/director/management-programmes.js';
import{createApp}from'../server/app.js';
import{readConfig}from'../server/config.js';
import{digest}from'../server/auth/crypto.js';
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
const payment=(row:any,sourceVersion:number,amount:string)=>({sourceRowId:row.id,sourceVersion,receiptVersion:row.receiptVersion??0,amount,paymentDate:'2026-10-29',transactionId:'TEST-'+randomUUID(),requestKey:randomUUID()});
test('PT creation remains awaiting submission; submission moves to awaiting payment; partial and full receipts keep exact reference and immutable financial source',async()=>{
 const f=await fixture();try{
  const sourceBefore=(await f.pool.query('SELECT snapshot FROM accounts_source_registers')).rows,legacyBefore=(await paymentRegister(f.pool,f.ids.Accounts)).pending;
  const siteId='live-ipo:'+randomUUID();await new OperationsBoardRepository(f.pool).importSource(f.ids.Admin,{sourceSha256:'e'.repeat(64),rows:[{id:siteId,ipo:'FICTIONAL-PT',name:'Fictional delivered site',customer:'UBL',customerPo:'ISOLATED-PO',stage:'delivered',installation:false,projectType:'delivery-only',operationsTeam:'central',deliveryDate:'2026-10-29'}]});
  await recordInvoiceEntry(f.pool,f.ids.Accounts,{sourceKind:'Operations',siteKey:siteId,sourceVersion:1,milestone:'delivery',ptReference:'PT-TEST-100',entryDate:'2026-10-28',notes:'Fictional issued PT invoice',requestKey:randomUUID()});
  const created=(await invoiceRegister(f.pool,f.ids.Accounts)).submissionQueues.deliveryOnly.find(r=>r.key===siteId)!;assert.equal(created.invoiceCreated,true);assert.deepEqual(created.invoiceReferences,['PT-TEST-100']);assert.ok(!(await paymentRegister(f.pool,f.ids.Accounts)).awaiting.some(r=>r.invoice==='PT-TEST-100'));
  await recordInvoiceSubmission(f.pool,f.ids.Accounts,{sourceKind:'Operations',siteKey:siteId,sourceVersion:1,milestone:'delivery',submissionDate:'2026-10-29',requestKey:randomUUID()});
  assert.ok(!(await invoiceRegister(f.pool,f.ids.Accounts)).submissionQueues.deliveryOnly.some(r=>r.key===siteId));
  let register=await paymentRegister(f.pool,f.ids.Accounts),row=register.awaiting.find(r=>r.invoice==='PT-TEST-100')!;assert.ok(row);assert.equal(row.pending,null);assert.equal(row.amount,null);
  await assert.rejects(recordInvoiceReceipt(f.pool,f.ids.Accounts,payment(row,1,'200.10')),/outstanding balance from PT/);
  const input={...payment(row,1,'200.10'),outstandingBefore:'1000.25'};const[one,retry]=await Promise.all([recordInvoiceReceipt(f.pool,f.ids.Accounts,input),recordInvoiceReceipt(f.pool,f.ids.Accounts,input)]);assert.equal(one.id,retry.id);
  register=await paymentRegister(f.pool,f.ids.Accounts);row=register.awaiting.find(r=>r.invoice==='PT-TEST-100')!;assert.equal(row.pending,'800.15');assert.equal(row.receiptVersion,1);assert.equal(register.receipts.length,1);
  await assert.rejects(recordInvoiceReceipt(f.pool,f.ids.Accounts,{...input,requestKey:randomUUID()}),/changed/);
  await assert.rejects(recordInvoiceReceipt(f.pool,f.ids.Accounts,{...payment(row,1,'1'),transactionId:input.transactionId}),/already recorded/);
  await assert.rejects(recordInvoiceReceipt(f.pool,f.ids.Accounts,payment(row,1,'801')),/exceeds/);
  await recordInvoiceReceipt(f.pool,f.ids.Accounts,payment(row,1,'800.15'));register=await paymentRegister(f.pool,f.ids.Accounts);assert.ok(!register.awaiting.some(r=>r.invoice==='PT-TEST-100'));assert.equal(register.receipts.length,2);
  assert.deepEqual(register.pending,legacyBefore,'Previously confirmed historical receipts retain all checking notes/data.');
  const billing=await f.source.billing(f.ids.Management),bill=billing.rows.find(r=>r.invoice==='PT-TEST-100')!;assert.equal(bill.pending,'0.00');assert.equal(bill.amount,null);assert.equal(bill.receiptConfirmed,true);
  assert.deepEqual((await f.pool.query('SELECT snapshot FROM accounts_source_registers')).rows,sourceBefore);assert.equal((await f.pool.query('SELECT count(*)::int n FROM stock_on_hand_entries')).rows[0].n,0);
  await assert.rejects(f.pool.query('DELETE FROM accounts_invoice_receipts'));await assert.rejects(f.pool.query("UPDATE accounts_invoice_receipts SET amount=1"));
 }finally{await f.close();}
});
test('known invoice balance reduces only by actual receipt, updates Management exact site, retains unrelated advance and invoice amount',async()=>{
 const f=await fixture();try{
  await recordInvoiceSubmission(f.pool,f.ids.Accounts,f.input);let register=await paymentRegister(f.pool,f.ids.Accounts),row=register.awaiting.find(r=>r.invoice==='27-10001')!;assert.equal(row.pending,'750.10');
  await recordInvoiceReceipt(f.pool,f.ids.Accounts,payment(row,1,'200.10'));const b=await f.source.billing(f.ids.Management),bill=b.rows.find(r=>r.invoice==='27-10001')!;assert.equal(bill.amount,'1000.25');assert.equal(bill.pending,'550.00');assert.equal(bill.invoice,'27-10001');
  const management=await managementProgrammes(f.pool,f.ids.Management),site=management.programmes.flatMap(p=>p.rows).find(r=>r.sourceKey==='UBL:UPS:1/250')!;assert.equal(site.remainingPayable,'550.00');assert.equal(site.paymentReceived,false);
  row=(await paymentRegister(f.pool,f.ids.Accounts)).awaiting.find(r=>r.invoice==='27-10001')!;await recordInvoiceReceipt(f.pool,f.ids.Accounts,payment(row,1,'550.00'));
  const paid=(await managementProgrammes(f.pool,f.ids.Management)).programmes.flatMap(p=>p.rows).find(r=>r.sourceKey==='UBL:UPS:1/250')!;assert.equal(paid.paymentReceived,true);assert.equal(paid.remainingPayable,'0.00');
  const solar=(await f.source.billing(f.ids.Management)).rows.find(r=>r.id==='UBL:SOLAR:2:advance')!;assert.equal(solar.pending,'0');
 }finally{await f.close();}
});
test('role, request identity, dates, overpayment, stale balance and CSRF protect actual receipt entry',async()=>{
 const f=await fixture();try{
  await recordInvoiceSubmission(f.pool,f.ids.Accounts,f.input);const row=(await paymentRegister(f.pool,f.ids.Accounts)).awaiting.find(r=>r.invoice==='27-10001')!,input=payment(row,1,'50');
  await assert.rejects(recordInvoiceReceipt(f.pool,f.ids.Inventory,input),/Accounts access required/);await assert.rejects(recordInvoiceReceipt(f.pool,f.ids.Management,input),/receipt recording access/);
  await assert.rejects(recordInvoiceReceipt(f.pool,f.ids.Accounts,{...input,paymentDate:'2099-01-01'}),/future/);await assert.rejects(recordInvoiceReceipt(f.pool,f.ids.Accounts,{...input,outstandingBefore:'750.10'}),/existing outstanding/);await assert.rejects(recordInvoiceReceipt(f.pool,f.ids.Accounts,{...input,sourceVersion:2}),/changed/);
  const token=randomBytes(32).toString('base64url'),csrf=randomUUID();await f.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at)VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),f.ids.Accounts,csrf]);
  const app=createApp(f.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:'http://localhost:3000',DATABASE_URL:f.url,ADMIN_SETUP_TOKEN:'receipt-flow-isolated-setup-token-only'}));
  await request(app).post('/api/accounts-workspace/invoice-receipts').set('Origin','http://localhost:3000').set('Cookie','pz_session='+token).send(input).expect(403);
  await request(app).post('/api/accounts-workspace/invoice-receipts').set('Origin','http://localhost:3000').set('Cookie','pz_session='+token).set('X-CSRF-Token',csrf).send({...input,invoiceReference:'REPLACE'}).expect(400);
  await request(app).post('/api/accounts-workspace/invoice-receipts').set('Origin','http://localhost:3000').set('Cookie','pz_session='+token).set('X-CSRF-Token',csrf).send(input).expect(201);
  const counts=(await request(app).get('/api/accounts-workspace/work-queues').set('Cookie','pz_session='+token).expect(200)).body,register=await paymentRegister(f.pool,f.ids.Accounts);assert.equal(counts.paymentsToRecord,register.pending.length+register.awaiting.length);
 }finally{await f.close();}
});
test('changed imported balance is held instead of subtracting a receipt twice; no input mutation or false paid state',()=>{
 const rows=[{id:'a',customer:'UBL',invoice:'I-1',pending:'800',submission:'Submitted',receiptConfirmed:false},{id:'b',customer:'UBL',invoice:'I-2',pending:'100',submission:'Not submitted'}],events=[{ledger_key:'row:a',invoice_reference:'I-1',customer:'UBL',baseline_pending:'1000',amount:'200',payment_date:'2026-10-29',snapshot:{originalPending:'1000'}}],before=JSON.stringify(rows);
 const result=applyInvoiceReceipts(rows,events);assert.ok(result[0].receiptHold);assert.equal(result[0].pending,'800');assert.equal(result[0].receiptConfirmed,false);assert.equal(JSON.stringify(rows),before);assert.equal(awaitingInvoicePayments(result,[]).length,1);
});

test('programme payment status covers all exact linked UPS invoices, not only the last receipt',()=>{
 const source={registers:[{rows:[{key:'UBL:UPS:1/250',kind:'UPS',customer:'UBL',invoiceReferences:['27-10001','27-10002'],singlePaymentReceived:false}]}]},rows=[{id:'system:United Bank Limited:27-10001',invoice:'27-10001',category:'System',customer:'United Bank Limited',pending:'0.00',amount:'100',receiptSourceKey:'UBL:UPS:1/250',operationalReceived:'100'},{id:'system:United Bank Limited:27-10002',invoice:'27-10002',category:'System',customer:'United Bank Limited',pending:'25.10',amount:'50'}];
 const site=applyReceiptProgramme(source,rows).registers[0].rows[0];assert.equal(site.singlePaymentReceived,false);assert.equal(site.operationalOutstanding,'25.10');assert.equal(site.operationalReceivedAmount,'124.90');assert.equal(source.registers[0].rows[0].singlePaymentReceived,false);
});

test('a submission covering multiple invoices keeps their receipt ledgers separate',()=>{
 const rows=[{id:'a',submissionId:'shared',customer:'UBL',invoice:'27-10001',pending:'100',submission:'Submitted'},{id:'b',submissionId:'shared',customer:'UBL',invoice:'27-10002',pending:'200',submission:'Submitted'}],events=[{ledger_key:'submission:shared:invoice:27-10001',submission_id:'shared',invoice_reference:'27-10001',customer:'UBL',baseline_pending:'100',amount:'25',payment_date:'2026-10-29',snapshot:{originalPending:'100'}}];
 const result=applyInvoiceReceipts(rows,events);assert.equal(result[0].pending,'75.00');assert.equal(result[1].pending,'200');assert.equal(result[1].receiptVersion,0);assert.ok(!result[1].receiptHold);
});
