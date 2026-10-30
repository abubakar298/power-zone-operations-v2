import{test}from'node:test';
import assert from'node:assert/strict';
import{invoiceCategory,invoiceType}from'../shared/accounts-invoice-display.js';
import{applyInvoiceSubmissionBilling}from'../server/accounts/invoice-submission-state.js';
test('one site retains distinct advance, balance, cable and internet obligations',()=>{
 const rows=[
  {id:'UBL:SOLAR:345:advance',category:'System · advance',invoice:'27-10590',pending:'3900000'},
  {id:'UBL:SOLAR:345:completion',category:'System · completion',invoice:'27-10590',pending:'3900000'},
  {id:'cable:345',category:'Extra cable',invoice:'27-10600',pending:'10000'},
  {id:'internet:345',category:'Internet',invoice:'27-50100',pending:'28600'},
 ];
 const before=structuredClone(rows);
 assert.deepEqual(rows.map(invoiceType),['50% Advance Invoice','Balance Invoice','Extra Cable Invoice','Internet Invoice']);
 assert.equal(rows.filter(r=>invoiceCategory(r)==='solar').length,2);
 assert.deepEqual(rows,before);
});
test('native submissions retain exact source phase for display without inventing a balance',()=>{
 const events=[{id:'balance',source_key:'UBL:SOLAR:345',milestone:'completion',invoice_reference:'27-10590-S',submitted_on:'2026-10-28',snapshot:{customer:'United Bank Limited',site:'Walton',billingIds:[]}},
 {id:'delivery',source_key:'live-CHP-350',milestone:'delivery',invoice_reference:'27-50191',submitted_on:'2026-10-20',snapshot:{customer:'Elahi',site:'Elahi',billingIds:[]}}];
 const before=structuredClone(events),rows=applyInvoiceSubmissionBilling([],events);
 assert.deepEqual(rows.map(invoiceType),['Balance Invoice','Delivery Only Invoice']);
 assert.deepEqual(rows.map(r=>r.pending),[null,null]);
 assert.deepEqual(events,before);
 assert.equal(invoiceCategory({id:'system:MBL:1',category:'System'}),'ups');
 assert.equal(invoiceType({id:'submission:ups',sourceKey:'MBL:338:1/60',category:'System · completion'}),'Installation / Completion Invoice');
});
