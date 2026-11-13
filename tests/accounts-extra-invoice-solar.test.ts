import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {AccountsSourceRegisters} from '../server/accounts/source-registers.js';
import {invoiceRegister,recordInvoiceEntry,recordInvoiceSubmission,invoiceSiteForPaymentRow} from '../server/accounts/invoice-entries.js';
import {paymentRegisterData} from '../server/accounts/payment-records.js';

// Solar 70: advance submitted in the reviewed register (awaiting payment), completion
// issued with an invoice but not yet submitted, plus a fully paid UPS site.
async function fixture(){
 const db=await testDatabase(),ids:Record<string,string>={};
 for(const role of ['Admin','Accounts','Management']){const id=ids[role]=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);}
 const solar={key:'UBL:SOLAR:7',kind:'Solar / BESS',program:'Solar 70',customer:'UBL',ipo:'CHP-7',site:'Fictional solar',delivered:true,installed:true,invoiceReferences:['27-30001'],advance:{invoiceAmount:'700',outstandingAmount:'700',submitted:true,received:false,submissionEvidence:'2026-10-20'},completion:{invoiceAmount:'300',outstandingAmount:'300',submitted:false,received:false}};
 const paid={key:'UBL:SOLAR:8',kind:'Solar / BESS',program:'Solar 70',customer:'UBL',ipo:'CHP-8',site:'Paid solar',delivered:true,installed:true,invoiceReferences:['27-30002'],advance:{invoiceAmount:'100',outstandingAmount:'0',submitted:true,received:true,submissionEvidence:'2026-10-01'},completion:{invoiceAmount:'100',outstandingAmount:'0',submitted:true,received:true,submissionEvidence:'2026-10-02'}};
 await new AccountsSourceRegisters(db.pool).import(ids.Admin,{sourceDate:'2026-10-29',manifest:[{name:'Isolated solar',sha256:'d'.repeat(64)}],registers:[{rows:[solar,paid]}],cables:{rows:[]},internet:{rows:[]},sites:{rows:[]},evidence:{rows:[],cableStageAdjustments:[]}},0);
 return {db,ids,solar};
}
const awaiting=async(pool:any)=>(await paymentRegisterData(pool)).awaiting as any[];
const solarRows=(rows:any[])=>rows.filter(r=>r.site==='Fictional solar').map(r=>[r.invoice,r.category,r.amount,r.pending]).sort();

test('Solar sites in Awaiting payment: extra invoice for a register-submitted advance and a portal-submitted completion',async()=>{
 const {db,ids,solar}=await fixture();try{
  const before=await invoiceRegister(db.pool,ids.Accounts);
  // Lock current behaviour: the submitted advance is not in Invoices to Submit; the completion is.
  assert.equal(before.submissionQueues.delivery.some((r:any)=>r.key===solar.key),false);
  const completion=before.submissionQueues.completion.find((r:any)=>r.key===solar.key)!;assert.ok(completion);
  const advanceRow=(await awaiting(db.pool)).find(r=>r.site==='Fictional solar'&&r.category==='System · advance')!;
  assert.equal(advanceRow.submissionId,undefined,'register-submitted: no portal submission link');

  // 1. Advance (submitted in the register): the row finds its site milestone.
  const advance=await invoiceSiteForPaymentRow(db.pool,ids.Accounts,advanceRow.id);
  assert.deepEqual([advance.sourceKind,advance.key,advance.milestone],['Source register',solar.key,'delivery']);
  await assert.rejects(recordInvoiceEntry(db.pool,ids.Management,{sourceKind:'Source register',siteKey:solar.key,sourceVersion:advance.sourceVersion,milestone:'delivery',ptReference:'27-30010',entryDate:'2026-10-25',notes:'',requestKey:randomUUID()}),/access required/);
  await assert.rejects(recordInvoiceEntry(db.pool,ids.Accounts,{sourceKind:'Source register',siteKey:solar.key,sourceVersion:advance.sourceVersion,milestone:'delivery',ptReference:'27-30002',entryDate:'2026-10-25',notes:'',requestKey:randomUUID()}),/another site/,'number owned by another site stays refused');
  const extra=await recordInvoiceEntry(db.pool,ids.Accounts,{sourceKind:'Source register',siteKey:solar.key,sourceVersion:advance.sourceVersion,milestone:'delivery',ptReference:'27-30010',invoiceLabel:'Extra panels',amount:'50',entryDate:'2026-10-25',notes:'',requestKey:randomUUID()});
  assert.equal(extra.site_key,solar.key);
  // The extra invoice waits in Invoices to Submit; it is submitted on its own.
  const queued=(await invoiceRegister(db.pool,ids.Accounts)).submissionQueues.delivery.find((r:any)=>r.key===solar.key)!;
  assert.deepEqual(queued.invoices.map((i:any)=>[i.reference,i.submittedOn]),[['27-30010',null]]);
  await recordInvoiceSubmission(db.pool,ids.Accounts,{sourceKind:'Source register',siteKey:solar.key,sourceVersion:queued.sourceVersion,milestone:'delivery',submissionDate:'2026-10-26',invoiceEntryId:extra.id,requestKey:randomUUID()});

  // 2. Completion submitted in the portal: solar rows are split per number, losing submissionId.
  await recordInvoiceSubmission(db.pool,ids.Accounts,{sourceKind:'Source register',siteKey:solar.key,sourceVersion:completion.sourceVersion,milestone:'completion',submissionDate:'2026-10-27',requestKey:randomUUID()});
  const completionRow=(await awaiting(db.pool)).find(r=>r.site==='Fictional solar'&&r.category==='System · completion')!;
  const site=await invoiceSiteForPaymentRow(db.pool,ids.Accounts,completionRow.id);
  assert.deepEqual([site.sourceKind,site.key,site.milestone],['Source register',solar.key,'completion']);
  await recordInvoiceEntry(db.pool,ids.Accounts,{sourceKind:'Source register',siteKey:solar.key,sourceVersion:site.sourceVersion,milestone:'completion',ptReference:'27-30011',entryDate:'2026-10-28',notes:'',requestKey:randomUUID()});

  // Existing balances are untouched; the submitted extra invoice is its own receivable.
  assert.deepEqual(solarRows(await awaiting(db.pool)),[['27-30001','System · advance','700.00','700.00'],['27-30001','System · completion','300.00','300.00'],['27-30010','System · advance','50.00','50.00']].sort());
  // A fully paid site is not awaiting payment, so it has no row to open.
  assert.equal((await awaiting(db.pool)).some(r=>r.site==='Paid solar'),false);
  await assert.rejects(recordInvoiceEntry(db.pool,ids.Accounts,{sourceKind:'Source register',siteKey:'UBL:SOLAR:8',sourceVersion:site.sourceVersion,milestone:'completion',ptReference:'27-30012',entryDate:'2026-10-28',notes:'',requestKey:randomUUID()}),/changed/);
 }finally{await db.close();}
});
