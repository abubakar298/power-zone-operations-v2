import{test}from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';
import{applyMeezanInvoiceValues}from'../server/accounts/meezan-invoice-values.js';import{applyInvoiceReceipts}from'../server/accounts/invoice-receipt-state.js';import{testDatabase}from'./database.js';import{AccountsSourceRegisters}from'../server/accounts/source-registers.js';import{paymentRegisterData}from'../server/accounts/payment-records.js';import{recordInvoiceReceipt}from'../server/accounts/invoice-receipts.js';
const row=(batch:number)=>({id:'submission:'+batch,sourceKey:`MBL:CHP-233:${batch}-site order:3/${batch}`,category:'System · completion',customer:'Meezan Bank Limited',invoice:'27-20000',amount:null,pending:null,receiptConfirmed:false});
test('exact Meezan programme values fill gaps only, preserving existing balances and invoice identity',()=>{
 const input=[row(20),row(60),row(80)],before=structuredClone(input),out=applyMeezanInvoiceValues(input);
 assert.deepEqual(input,before);assert.deepEqual(out.map(r=>r.amount),['935000.00','660000.00','660000.00']);assert.deepEqual(out.map(r=>r.pending),out.map(r=>r.amount));
 for(const r of [{...row(20),amount:'935000.00',pending:'12345.67'},{...row(60),amount:'660000.00',pending:'0',receiptConfirmed:true}])assert.equal(applyMeezanInvoiceValues([r])[0].pending,r.pending);
 for(const r of [{...row(20),customer:'United Bank Limited'},{...row(20),category:'Extra cable'},{...row(20),category:'Internet'},{...row(20),sourceKey:'unknown',invoice:'27-20000-3/20'},{...row(20),sourceKeys:['one','two']},{...row(20),sourceKey:'MBL:CHP-233:20-site order:3/60'}])assert.equal(applyMeezanInvoiceValues([r])[0].amount,null);
 assert.equal(applyMeezanInvoiceValues([{...row(20),receiptHold:'Source changed'}])[0].pending,null);
});
test('existing unknown-source receipt baselines remain valid after applying confirmed invoice values',()=>{
 const r={...row(20),id:'row20'},receipt={ledger_key:'row:row20',invoice_reference:r.invoice,customer:r.customer,amount:'100000',baseline_pending:'935000',snapshot:{originalPending:null},payment_date:'2026-10-30'};
 const projected=applyMeezanInvoiceValues(applyInvoiceReceipts([r],[receipt]))[0];assert.equal(projected.pending,'835000.00');assert.equal(projected.receiptHold,undefined);assert.equal(projected.amount,'935000.00');
});
test('Accounts and Management use the same fixed amount and retain partial receipts without rewriting the source',async()=>{
 const db=await testDatabase();try{
 const admin=randomUUID(),account=randomUUID();for(const[id,role]of[[admin,'Admin'],[account,'Accounts']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);
 const repo=new AccountsSourceRegisters(db.pool);await repo.import(admin,{sourceDate:'2026-10-30',manifest:[{name:'Isolated',sha256:'a'.repeat(64)}],registers:[{rows:[]}],sites:{rows:[]},cables:{rows:[]},internet:{rows:[]},evidence:{rows:[],cableStageAdjustments:[]}},0);
 const before=(await db.pool.query('SELECT snapshot FROM accounts_source_registers')).rows;
 const id=randomUUID();await db.pool.query(`INSERT INTO accounts_invoice_submissions(id,source_kind,site_key,source_key,source_version,milestone,invoice_reference,submitted_on,snapshot,request,request_key,created_by) VALUES($1,'Source register',$2,$2,1,'completion','27-20000','2026-10-29',$3,'{}',$4,$5)`,[id,row(20).sourceKey,{customer:'Meezan Bank Limited',site:'Fictional branch',ipo:'CHP-233',billingIds:[]},randomUUID(),account]);
 let d=await paymentRegisterData(db.pool);const r=d.awaiting.find(r=>r.submissionId===id)!;assert.equal(r.pending,'935000.00');assert.equal((await repo.billing(admin)).rows.find(x=>x.id===r.id)?.pending,r.pending);
 await recordInvoiceReceipt(db.pool,account,{sourceRowId:r.id,sourceVersion:1,receiptVersion:0,amount:'100000',transactionId:'fictional-partial',paymentDate:'2026-10-30',requestKey:randomUUID()});
 d=await paymentRegisterData(db.pool);const partial=d.awaiting.find(x=>x.id===r.id)!;assert.equal(partial.pending,'835000.00');assert.equal(partial.receiptHold,undefined);assert.equal((await repo.billing(admin)).rows.find(x=>x.id===r.id)?.pending,partial.pending);
 await recordInvoiceReceipt(db.pool,account,{sourceRowId:r.id,sourceVersion:1,receiptVersion:1,amount:'835000',transactionId:'fictional-final',paymentDate:'2026-10-30',requestKey:randomUUID()});assert.equal((await paymentRegisterData(db.pool)).awaiting.some(x=>x.id===r.id),false);assert.deepEqual((await db.pool.query('SELECT snapshot FROM accounts_source_registers')).rows,before);
 }finally{await db.close();}
});
