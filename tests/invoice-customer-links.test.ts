import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {testDatabase} from './database.js';
import {invoiceSubmissions} from '../server/accounts/invoice-submission-state.js';
import {paymentRegisterData} from '../server/accounts/payment-records.js';
import {applyInvoiceCorrections} from '../server/accounts/invoice-correction-state.js';
import {applyInvoiceReceipts} from '../server/accounts/invoice-receipt-state.js';
import {AccountsSourceRegisters} from '../server/accounts/source-registers.js';

test('exact IPO customers repair missing labels without rewriting source invoices, money, stock or workflow history',async()=>{
 const db=await testDatabase();try{
  const admin=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Customer link QA','Admin','isolated')",[admin,admin+'@example.test']);
  await new AccountsSourceRegisters(db.pool).import(admin,{sourceDate:'2026-10-31',manifest:[{name:'Isolated customer link check',sha256:'b'.repeat(64)}],registers:[{rows:[]}],sites:{rows:[]},cables:{rows:[]},internet:{rows:[]},evidence:{rows:[],cableStageAdjustments:[]}},0);
  let sequence=0;
  async function fixture(options:{customer?:string;wrongOrigin?:boolean;wrongKey?:boolean}={}){
   const n=++sequence,ipo=randomUUID(),po=randomUUID(),submission=randomUUID(),site='live-ipo:'+ipo;
   await db.pool.query("INSERT INTO customer_purchase_orders(id,customer_id,po_number,input,created_by) VALUES($1,2,$2,'{}',$3)",[po,'SIM-CUSTOMER-PO-'+n,admin]);
   await db.pool.query("INSERT INTO internal_purchase_orders(id,customer_po_id,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,$3,'{}',$4,$5,$6)",[ipo,po,'SIM-CUSTOMER-IPO-'+n,'c'.repeat(64),randomUUID(),admin]);
   const snapshot={id:site,name:'Same branch display name',ipo:'SHARED-IPO',customer:options.customer,stage:'completed',completed:true,installation:true,projectType:'ups',deliveryDate:'2026-10-20',qc:{handover:{date:'2026-10-25'}},documents:[{label:'Saved signed evidence',location:'Accounts'}],origin:{kind:'live-ipo-handoff',ipoId:options.wrongOrigin?randomUUID():ipo}};
   await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[site,admin]);
   await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Source imported','QA',$3,$4)",[site,snapshot,randomUUID(),admin]);
   const invoiceSnapshot={site:snapshot.name,ipo:snapshot.ipo,customer:options.customer??'Customer not recorded',billingIds:[],invoiceReferences:['SIM-INV-'+n]};
   await db.pool.query("INSERT INTO accounts_invoice_submissions(id,source_kind,site_key,source_key,source_version,milestone,invoice_reference,submitted_on,snapshot,request,request_key,created_by) VALUES($1,'Operations',$2,$3,1,'completion',$4,'2026-10-26',$5,'{}',$6,$7)",[submission,site,'issued:'+(options.wrongKey?randomUUID():ipo),'SIM-INV-'+n,invoiceSnapshot,randomUUID(),admin]);
   return {site,ipo,submission,snapshot,invoiceSnapshot};
  }
  const missing=await fixture(),known=await fixture({customer:'Reviewed customer — retain'}),wrongOrigin=await fixture({wrongOrigin:true}),wrongKey=await fixture({wrongKey:true});
  const customer=(await db.pool.query('SELECT name FROM customers WHERE id=2')).rows[0].name;
  const protectedTables=['accounts_source_registers','accounts_invoice_submissions','accounts_invoice_entries','accounts_invoice_receipts','accounts_invoice_corrections','accounts_payment_records','internal_purchase_orders','customer_purchase_orders','inventory_warehouse_operational_movements'];
  async function proof(){const out:Record<string,string>={};for(const table of protectedTables)out[table]=(await db.pool.query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) h FROM ${table} t`)).rows[0].h;return out;}
  const before=await proof(),events=await invoiceSubmissions(db.pool);
  assert.equal(events.find(e=>e.id===missing.submission)!.snapshot.customer,customer);
  assert.equal(events.find(e=>e.id===known.submission)!.snapshot.customer,'Reviewed customer — retain');
  assert.equal(events.find(e=>e.id===wrongKey.submission)!.snapshot.customer,'Customer not recorded','Mismatched exact keys cannot guess from shared names or IPO labels');
  const payments=await paymentRegisterData(db.pool),management=await new AccountsSourceRegisters(db.pool).billing(admin);
  for(const rows of [payments.invoices,management.rows]){const row=rows.find(r=>r.id==='submission:'+missing.submission)!;assert.equal(row.customer,customer);assert.equal(row.amount,null);assert.equal(row.pending,null);assert.equal(row.invoice,'SIM-INV-1');}
  const migration=await readFile(new URL('../migrations/157_live_ipo_customer_links.sql',import.meta.url),'utf8');await db.pool.query(migration);
  const versions=(await db.pool.query('SELECT site_id,version,snapshot FROM operations_board_versions ORDER BY site_id,version')).rows;
  for(const f of [missing,wrongKey]){const v=versions.find(v=>v.site_id===f.site&&v.version===2)!;assert.equal(v.snapshot.customer,customer);assert.equal(v.snapshot.customerId,2);const {customer:_,customerId:__,customerLink:___,...rest}=v.snapshot;const {customer:____,...original}=JSON.parse(JSON.stringify(f.snapshot));assert.deepEqual(rest,original);}
  assert.equal(versions.filter(v=>v.site_id===known.site).length,1,'Do not replace a recorded customer');
  assert.equal(versions.filter(v=>v.site_id===wrongOrigin.site).length,1,'Origin must prove the same exact IPO');
  assert.deepEqual(versions.find(v=>v.site_id===missing.site&&v.version===1)!.snapshot,JSON.parse(JSON.stringify(missing.snapshot)));
  assert.deepEqual(await proof(),before,'Only new Operations versions and audit records are written');
  const versionCount=versions.length,auditCount=(await db.pool.query('SELECT count(*)::int n FROM audit_log')).rows[0].n;await db.pool.query(migration);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_board_versions')).rows[0].n,versionCount);assert.equal((await db.pool.query('SELECT count(*)::int n FROM audit_log')).rows[0].n,auditCount);
 }finally{await db.close();}
});

test('recovering a missing label retains exact-ledger receipts and corrections without accepting a different customer',()=>{
 const ipo=randomUUID(),row={id:'submission:old-iqra',sourceKey:'issued:'+ipo,customer:'Meezan Bank Limited',customerLink:{basis:'Exact saved IPO customer',ipoId:ipo,originalCustomer:'Customer not recorded'},invoice:'SIM-IQRA',amount:'100.00',pending:'100.00'};
 const correction={source_row_id:row.id,invoice_reference:row.invoice,submitted_on:'2026-10-26',version:1,snapshot:{originalInvoice:row.invoice,customer:'Customer not recorded'}};
 assert.equal(applyInvoiceCorrections([row],[correction])[0].invoiceCorrectionHold,undefined);
 const receipt={ledger_key:'row:'+row.id,invoice_reference:row.invoice,customer:'Customer not recorded',amount:'25.00',baseline_pending:'100.00',snapshot:{originalPending:'100.00'},payment_date:'2026-10-29'};
 const paid=applyInvoiceReceipts([row],[receipt])[0];assert.equal(paid.pending,'75.00');assert.equal(paid.receiptHold,undefined);
 assert.ok(applyInvoiceReceipts([row],[{...receipt,customer:'United Bank Limited'}])[0].receiptHold);
 assert.ok(applyInvoiceCorrections([row],[{...correction,snapshot:{...correction.snapshot,customer:'United Bank Limited'}}])[0].invoiceCorrectionHold);
 assert.ok(applyInvoiceReceipts([{...row,sourceKey:'issued:'+randomUUID()}],[receipt])[0].receiptHold);
});
