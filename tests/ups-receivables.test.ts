import test from 'node:test';
import assert from 'node:assert/strict';
import {upsReceivablesAgeing} from '../server/director/ups-receivables.js';
const now=new Date('2026-10-17T06:00:00Z');
const site=(n:number,status:any={})=>({orderNumber:`${n}/250`,recoveryStatus:{systemPaymentStatus:'Pending',invoiceStatus:'Submitted',deliveryStatus:'Delivered',installationStatus:'Completed',systemInvoices:[{invoice:`I${n}`,amount:'450000.00',paymentReceived:false}],recoveryEvidence:[{invoice:`I${n}`,submit:'2026-10-01 00:00:00',delivery:'2026-09-24 00:00:00',install:'2026-09-29 00:00:00'}],...status}});
test('invoice submission, delivery and completion clocks remain separate and amounts are exact',()=>{
 const r=upsReceivablesAgeing({sites:[site(1),site(2,{installationStatus:'Pending'}),site(3,{invoiceStatus:'Not submitted'})],completionConfirmations:{'1/250':{},'3/250':{}}},now);
 assert.deepEqual(r.rows.map(s=>[s.stage,s.days,s.amount]),[['submitted',16,'450000.00'],['awaiting-completion',23,'450000.00'],['unsubmitted',18,'450000.00']]);
});
test('received and unknown main payments never become receivables; cables cannot set the amount',()=>{
 const r=upsReceivablesAgeing({sites:[site(1,{systemPaymentStatus:'Received'}),site(2,{systemPaymentStatus:'Unverified'}),site(3,{systemInvoices:[],extraCableInvoices:[{invoice:'C3',amount:'99999.99',paymentReceived:false}]})]},now);
 assert.equal(r.rows.length,0);assert.equal(r.unverifiedPaymentSites,1);assert.equal(r.amountRequiredSites,1);
});
test('duplicate invoices do not double count; missing, conflicting and future dates stay unknown',()=>{
 const a=site(1,{recoveryEvidence:[]});a.recoveryStatus.systemInvoices.push({...a.recoveryStatus.systemInvoices[0]});
 const b=site(2,{recoveryEvidence:[{invoice:'I2',submit:'2026-10-18'}]});
 const c=site(3,{recoveryEvidence:[{invoice:'I3',submit:'2026-10-01'},{invoice:'I3',submit:'2026-10-02'}]});
 const r=upsReceivablesAgeing({sites:[a,b,c],completionApprovals:{'1/250':{},'2/250':{},'3/250':{}}},now);
 assert.equal(r.rows.length,3);assert.ok(r.rows.every(s=>s.band==='unknown'));assert.equal(r.rows[0].amount,'450000.00');
});
test('review is not treated as completion and conflicting invoice amounts are excluded',()=>{
 const a=site(1);a.recoveryStatus.systemInvoices.push({...a.recoveryStatus.systemInvoices[0],amount:'123.00'});
 const r=upsReceivablesAgeing({sites:[a,site(2)],installationAlerts:{'2/250':{status:'Review needed by Accounts'}}},now);
 assert.equal(r.rows.length,1);assert.equal(r.rows[0].stage,'review');assert.equal(r.rows[0].band,'unknown');assert.equal(r.amountRequiredSites,1);
});
