import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {recordInvoiceEntry,invoiceRegister,operationsInvoiceRows,invoiceEntrySchema} from '../server/accounts/invoice-entries.js';

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
  const register=await invoiceRegister(db.pool,ids.Accounts);assert.equal(register.queues.delivery.length,0);assert.equal(register.entries[0].pt_reference,'PT-100');assert.equal(register.entries[0].snapshot.ipo,'IPO-1');
  await assert.rejects(db.pool.query("UPDATE accounts_invoice_entries SET notes='changed' WHERE id=$1",[saved.id]));
  await assert.rejects(db.pool.query('DELETE FROM accounts_invoice_entries WHERE id=$1',[saved.id]));
  for(const table of ['internal_purchase_orders','accounts_job_closures','stock_on_hand_entries'])assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n,0);
 }finally{await db.close();}
});
