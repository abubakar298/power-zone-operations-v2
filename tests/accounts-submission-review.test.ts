import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {invoiceRegister,invoiceSubmissionRows} from '../server/accounts/invoice-entries.js';
import {billingRows} from '../server/accounts/billing-model.js';
import {paymentReviewNote} from '../shared/accounts-payment-review.js';
test('review migration preserves money/history and clears only verified submission work',async()=>{
 const db=await testDatabase();try{
 const actor=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,'accounts@test.example','Accounts','Accounts','test')",[actor]);
 const patches=JSON.parse(await readFile(new URL('../invoice-reconciliation-evidence.json',import.meta.url),'utf8'));
 const keys=[...new Set<string>(patches.map((p:any)=>p.key))];
 const rows:any[]=keys.map(key=>({key,site:key,ipo:'CHP-'+key.split(':').at(-1),po:patches.find((p:any)=>p.key===key).po,program:key.includes('SOLAR')?'Solar 70':'UPS 250',kind:key.includes('SOLAR')?'Solar / BESS':'UPS',customer:key.startsWith('MBL')?'MBL':'UBL',installed:true,delivered:true,invoiceReferences:key.includes('SOLAR')?['27-'+key.split(':').at(-1)+'00']:[],singleInvoiceSubmitted:false,singlePaymentReceived:key==='UBL:UPS:114/250',advance:{invoiceAmount:'1000.25',submitted:false,received:false},completion:{invoiceAmount:'1000.26',submitted:false,received:false}}));
 rows.push({key:'paid-without-ref',site:'Old paid site',ipo:'CHP-1',po:'',program:'UPS 250',kind:'UPS',customer:'UBL',installed:true,delivered:true,invoiceReferences:[],singleInvoiceSubmitted:true,singlePaymentReceived:true});
 const snapshot={registers:[{rows}],sites:{rows},cables:{rows:[]},internet:{rows:[]},evidence:{rows:[],cableStageAdjustments:[]},manifest:[{name:'Original',sha256:'a'.repeat(64)}]};
 await db.pool.query('INSERT INTO accounts_source_registers(id,version,source_sha256,source_date,snapshot,created_by) VALUES($1,2,$2,\'2026-10-29\',$3,$4)',[randomUUID(),'b'.repeat(64),snapshot,actor]);
 for(const row of rows){const id='registered-'+row.key;await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[id,actor]);await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Source imported','test',$3,$4)",[id,{sourceKey:row.key,name:row.site,ipo:row.ipo+' · 7/250',projectType:row.kind==='UPS'?'ups':'solar-bess',stage:'delivered',completed:true,installation:true},randomUUID(),actor]);}
 const before=billingRows(snapshot.registers,snapshot.cables,snapshot.internet,snapshot.evidence);
 await db.pool.query(await readFile(new URL('../migrations/148_accounts_invoice_submission_review.sql',import.meta.url),'utf8'));
 const versions=(await db.pool.query('SELECT version,snapshot FROM accounts_source_registers ORDER BY version')).rows;assert.equal(versions.length,2);assert.deepEqual(versions[0].snapshot,snapshot);
 const s=versions[1].snapshot;assert.equal(versions[1].version,3);const after=billingRows(s.registers,s.cables,s.internet,s.evidence);
 assert.deepEqual(after.map((r:any)=>[r.id,r.amount,r.pending]),before.map((r:any)=>[r.id,r.amount,r.pending]));
 for(const p of patches){const r=s.registers[0].rows.find((r:any)=>r.key===p.key);if(p.stage){assert.equal(r[p.stage].submitted,true);assert.equal(r[p.stage].submissionEvidence,p.date);}if(p.references)assert.deepEqual(r.verifiedInvoiceReferences,p.references);}
 const register=await invoiceRegister(db.pool,actor);const pending=Object.values(register.submissionQueues).flat() as any[];assert.ok(!pending.some(r=>r.key.includes('paid-without-ref')));
 assert.ok(pending.some(r=>r.key==='MBL:CHP-338:60-site order:15/60'&&r.invoiceCreated&&r.invoiceReferences.includes('27-20163')));
 assert.ok(pending.some(r=>r.key==='UBL:UPS:165/250'&&r.invoiceCreated&&r.invoiceReferences.includes('27-10620')));
 for(const p of patches.filter((p:any)=>p.stage))assert.ok(!pending.some(r=>r.key.replace(/^registered-/,'')===p.key&&r.milestone===(p.stage==='advance'?'delivery':p.stage)));
 for(const table of ['accounts_invoice_entries','accounts_payment_records','stock_on_hand_entries','accounts_job_closures'])assert.equal((await db.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);
 }finally{await db.close();}
});
test('payment holds are scoped to exact reviewed source identities',()=>{assert.match(paymentReviewNote('system:Meezan Bank Limited:26-20204',3)!,/two installments/);assert.equal(paymentReviewNote('system:United Bank Limited:26-20204',3),undefined);assert.equal(paymentReviewNote('system:Meezan Bank Limited:26-20204',4),undefined);});

test('registered Operations and source rows count once despite display IPO suffixes',()=>{const rows=invoiceSubmissionRows([{key:'registered-UBL:UPS:183/250',site:'Jaranwala',ipo:'CHP-163 · 183/250',milestone:'completion'},{key:'UBL:UPS:183/250',site:'Jaranwala',ipo:'CHP-163',milestone:'completion'}],[],[]);assert.equal(rows.length,1);});
