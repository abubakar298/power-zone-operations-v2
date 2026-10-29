import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AccountsSourceRegisters} from '../server/accounts/source-registers.js';
import {invoicingQueues} from '../server/accounts/billing-model.js';
import {testDatabase} from './database.js';
import {recordInvoiceEntry,invoiceRegister,operationsInvoiceRows,invoiceEntrySchema,importedInvoiceEntries,invoiceSubmissionRows} from '../server/accounts/invoice-entries.js';

test('invoice milestone projection excludes planned and partial sites and retains document-only evidence',()=>{
 const rows=operationsInvoiceRows([{site_id:'planned',version:1,snapshot:{stage:'awaiting',deliveries:[{partial:true}]}},{site_id:'delivered',version:2,snapshot:{name:'D',installation:true,invoiceOnDelivery:true,stage:'delivered',documents:[{id:'doc',evidence:[{id:'00000000-0000-4000-8000-000000000001',name:'Signed DO'}]}]}},{site_id:'complete',version:3,snapshot:{installation:true,invoiceOnDelivery:true,completed:true,stage:'delivered'}}]);
 assert.deepEqual(rows.map(r=>[r.key,r.milestone]),[['delivered','delivery'],['complete','delivery'],['complete','completion']]);
 assert.match(rows[0].evidence[0].url,/operations-board\/sites\/delivered\/files\/00000000/);
 assert.equal(invoiceEntrySchema.safeParse({amount:'100'}).success,false);
});
test('delivery-only completion remains a single delivery invoice; UPS uses only completion',()=>{
 const projected=operationsInvoiceRows([{site_id:'delivery-only',version:1,snapshot:{stage:'delivered',completed:true,installation:false,projectType:'delivery-only'}},{site_id:'ups',version:1,snapshot:{stage:'delivered',completed:true,installation:true,projectType:'ups'}},{site_id:'single-install',version:1,snapshot:{stage:'delivered',completed:true,installation:true}}]);
 assert.deepEqual(projected.map(r=>[r.key,r.milestone]),[['delivery-only','delivery'],['ups','completion'],['single-install','completion']]);
 const solar=operationsInvoiceRows([{site_id:'solar',version:1,snapshot:{ipo:'IPO-70',name:'Solar example',stage:'delivered',completed:true,installation:true}}],[{rows:[{ipo:'IPO-70',site:'Solar example',program:'Solar 70'}]}]);
 assert.deepEqual(solar.map(r=>r.milestone),['delivery','completion']);
});
test('PT invoice references are immutable, version checked, exactly once and leave financial tables untouched',async()=>{
 const db=await testDatabase();try{
  const ids={Accounts:randomUUID(),Management:randomUUID(),Inventory:randomUUID()};
  for(const [role,id]of Object.entries(ids))await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);
  const site='invoice-test-site';await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[site,ids.Accounts]);
  await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Test','Test',$3,$4)",[site,{name:'Example',ipo:'IPO-1',installation:true,invoiceOnDelivery:true,stage:'delivered',completed:false,documents:[]},randomUUID(),ids.Accounts]);
  const input={sourceKind:'Operations' as const,siteKey:site,sourceVersion:1,milestone:'delivery' as const,ptReference:'PT-100',entryDate:'2026-10-29',notes:'Recorded externally',requestKey:randomUUID()};
  assert.equal((await invoiceRegister(db.pool,ids.Accounts)).queues.delivery.length,1);
  await assert.rejects(recordInvoiceEntry(db.pool,ids.Management,input),/recording access/);
  await assert.rejects(recordInvoiceEntry(db.pool,ids.Inventory,input),/Accounts access/);
  await assert.rejects(recordInvoiceEntry(db.pool,ids.Accounts,{...input,sourceVersion:2}),/changed/);
  await assert.rejects(recordInvoiceEntry(db.pool,ids.Accounts,{...input,milestone:'completion'}),/changed/);
  const saved=await recordInvoiceEntry(db.pool,ids.Accounts,input);
  assert.equal((await recordInvoiceEntry(db.pool,ids.Accounts,input)).id,saved.id);
  await assert.rejects(recordInvoiceEntry(db.pool,ids.Accounts,{...input,notes:'Changed'}),/Request key/);
  await assert.rejects(recordInvoiceEntry(db.pool,ids.Accounts,{...input,requestKey:randomUUID()}),/already has/);
  const register=await invoiceRegister(db.pool,ids.Accounts);assert.equal(register.queues.delivery.length,0);assert.equal(register.submissionQueues.delivery.length,1);assert.equal(register.submissionQueues.delivery[0].invoiceCreated,true);assert.deepEqual(register.submissionQueues.delivery[0].invoiceReferences,['PT-100']);assert.equal(register.entries[0].pt_reference,'PT-100');assert.equal(register.entries[0].snapshot.ipo,'IPO-1');
  await assert.rejects(db.pool.query("UPDATE accounts_invoice_entries SET notes='changed' WHERE id=$1",[saved.id]));
  await assert.rejects(db.pool.query('DELETE FROM accounts_invoice_entries WHERE id=$1',[saved.id]));
  for(const table of ['internal_purchase_orders','accounts_job_closures','stock_on_hand_entries'])assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n,0);
 }finally{await db.close();}
});

test('existing invoices link by stable registered source ID, never by formatted IPO guesses or unrelated cable references',()=>{
 const op={site_id:'registered-UBL:UPS:7/250',version:1,snapshot:{name:'Example',ipo:'CHP-163 · 7/250',projectType:'ups',installation:true,completed:true,stage:'delivered'}};
 const row={key:'UBL:UPS:7/250',site:'Example',ipo:'CHP-163',kind:'UPS',invoiceReferences:['27-10123','27-10123','27-50123','Payment received 9 June']};
 const source={version:2,snapshot:{registers:[{rows:[row]}],cables:{rows:[{invoice:'27-50123'}]},internet:{rows:[]}}};
 const linked=importedInvoiceEntries([op],source);assert.equal(linked.length,1);assert.equal(linked[0].pt_reference,'27-10123');assert.equal(linked[0].entry_date,null);assert.equal(linked[0].milestone,'completion');assert.equal(linked[0].snapshot.sourceKey,row.key);
 assert.equal(importedInvoiceEntries([op],{...source,snapshot:{...source.snapshot,registers:[{rows:[row,row]}]}}).length,0);
 assert.equal(importedInvoiceEntries([{...op,snapshot:{...op.snapshot,completed:false,stage:'awaiting'}}],source).length,0);
});
test('linking submitted source invoices removes duplicate completion work without writing new invoices or changing balances',async()=>{
 const db=await testDatabase();try{
 const admin=randomUUID(),accounts=randomUUID();for(const [id,role]of [[admin,'Admin'],[accounts,'Accounts']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);
 const key='UBL:UPS:7/250',site='registered-'+key;
 const row={key,site:'Example',ipo:'CHP-163',kind:'UPS',program:'UBL UPS 250',installed:true,singleInvoiceSubmitted:true,singlePaymentReceived:true,invoiceReferences:['27-10123'],actualInvoiceAmount:'1000.25'};
 const sources=new AccountsSourceRegisters(db.pool);await sources.import(admin,{sourceDate:'2026-10-29',manifest:[{name:'Reviewed source',sha256:'a'.repeat(64)}],registers:[{rows:[row]}],cables:{rows:[]},internet:{rows:[]},sites:{rows:[]},evidence:{rows:[],cableStageAdjustments:[]}},0);
 await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[site,admin]);
 await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Source imported','Isolated reviewed fixture',$3,$4)",[site,{name:'Example',ipo:'CHP-163 · 7/250',projectType:'ups',installation:true,completed:true,stage:'delivered'},randomUUID(),admin]);
 const before=await sources.billing(accounts),register=await invoiceRegister(db.pool,accounts);
 assert.equal(register.importedCount,1);assert.equal(register.queues.completion.length,0);assert.equal(register.entries[0].pt_reference,'27-10123');assert.equal(register.entries[0].entry_date,null);
 await assert.rejects(recordInvoiceEntry(db.pool,accounts,{sourceKind:'Operations',siteKey:site,sourceVersion:1,milestone:'completion',ptReference:'DUPLICATE',entryDate:'2026-10-29',notes:'',requestKey:randomUUID()}),/changed/);
 assert.deepEqual(await sources.billing(accounts),before);
 for(const table of ['accounts_invoice_entries','internal_purchase_orders','stock_on_hand_entries','accounts_job_closures'])assert.equal((await db.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);
 }finally{await db.close();}
});

test('existing Solar invoice references cover only stages confirmed in the source',()=>{
 const row={key:'UBL:SOLAR:70',ipo:'CHP-70',site:'Solar',kind:'Solar / BESS',program:'Solar 70',invoiceReferences:['27-10101'],advance:{invoiceAmount:'500'},completion:{invoiceAmount:null}};
 const source={version:2,snapshot:{registers:[{rows:[row]}],cables:{rows:[]},internet:{rows:[]}}};
 const op={site_id:'registered-'+row.key,version:1,snapshot:{name:row.site,ipo:row.ipo,installation:true,stage:'delivered',completed:true}};
 assert.deepEqual(importedInvoiceEntries([op],source)[0].knownMilestones,['delivery']);
 row.completion.invoiceAmount='500' as any;assert.deepEqual(importedInvoiceEntries([op],source)[0].knownMilestones,['delivery','completion']);
 assert.deepEqual(importedInvoiceEntries([{...op,snapshot:{...op.snapshot,completed:false}}],source)[0].knownMilestones,['delivery']);
});


test('submission worklist covers delivery-only, staged delivery and completion, including invoices already created',()=>{
 const ready=[{key:'direct',site:'Direct',ipo:'1',deliveryOnly:true,milestone:'delivery'},{key:'solar',site:'Solar',ipo:'2',milestone:'delivery'},{key:'install',site:'Install',ipo:'3',milestone:'completion'}];
 const issued=[{key:'direct-issued',site:'Direct issued',ipo:'4',deliveryOnly:true,milestone:'delivery',invoiceReferences:['27-10001']},{key:'solar-issued',site:'Solar issued',ipo:'5',milestone:'delivery',invoiceReferences:['27-10002']},{key:'install-issued',site:'Install issued',ipo:'6',milestone:'completion',invoiceReferences:['27-10003']}];
 const rows=invoiceSubmissionRows(ready,issued,[]);
 assert.deepEqual(rows.map(r=>r.billingStage),['delivery-only','delivery','completion','delivery-only','delivery','completion']);
 assert.deepEqual(rows.map(r=>r.invoiceCreated),[false,false,false,true,true,true]);
 assert.equal(invoiceSubmissionRows([...ready,ready[0]],issued,[]).length,6);
});

test('source submission eligibility retains created invoices but excludes submitted, paid, cancelled and premature milestones',()=>{
 const direct={key:'direct',site:'Direct',ipo:'D',deliveryOnly:true,delivered:true,invoiceReferences:['27-10001']};
 const solar={key:'solar',site:'Solar',ipo:'S',program:'Solar 70',delivered:true,installed:true,invoiceReferences:['27-10002'],advance:{invoiceAmount:'500',submitted:false},completion:{invoiceAmount:null,submitted:false}};
 const ups={key:'ups',site:'UPS',ipo:'U',kind:'UPS',installed:true,invoiceReferences:[],singleInvoiceSubmitted:false};
 const queues=invoicingQueues([{rows:[direct,solar,ups,{...direct,key:'submitted',singleInvoiceSubmitted:true},{...ups,key:'paid',singlePaymentReceived:true},{...solar,key:'cancelled',cancelled:true},{...ups,key:'premature',installed:false}]}]);
 const rows=invoiceSubmissionRows([...queues.delivery.map(r=>({...r,milestone:'delivery'})),...queues.completion.map(r=>({...r,milestone:'completion'}))],queues.alreadyIssued.map(r=>({...r,milestone:r.milestone==='advance'?'delivery':r.milestone})),[]);
 assert.equal(rows.length,4);
 assert.equal(rows.filter(r=>r.billingStage==='delivery-only').length,1);
 assert.equal(rows.filter(r=>r.billingStage==='delivery').length,1);
 assert.equal(rows.filter(r=>r.billingStage==='completion').length,2);
 assert.equal(rows.filter(r=>r.invoiceCreated).length,2);
});
