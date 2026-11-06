import test from 'node:test';import assert from 'node:assert/strict';
import {upsBatchProgress} from '../server/director/ups-progress.js';
test('submitted bucket counts completed sites with system-invoice submission evidence only',()=>{
 const sites=[{orderNumber:'1/250',recoveryStatus:{invoiceStatus:'Submitted',systemInvoices:[{section:'Submitted',amount:'450000',paymentReceived:true}]}},{orderNumber:'2/250',recoveryStatus:{invoiceStatus:'Submitted',systemInvoices:[],extraCableInvoices:[{section:'Submitted',amount:'12000'}]}},{orderNumber:'3/250',recoveryStatus:{invoiceStatus:'Submitted',systemInvoices:[{section:'Submitted',amount:'450000',paymentReceived:false}],deliveryStatus:'Delivered',installationStatus:'Pending'}}];
 const result=upsBatchProgress({totalSites:250,sites,completionApprovals:{'1/250':{}},completionConfirmations:{'2/250':{}}});
 assert.equal(result.completed,2);assert.equal(result.completedInvoicesSubmitted,1);assert.equal(result.delivered,1);
});
