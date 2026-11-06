import test from 'node:test';
import assert from 'node:assert/strict';
import {upsBatchProgress} from '../server/director/ups-progress.js';
test('batch totals partition every listed site without treating missing evidence as undelivered',()=>{
 const r:any={totalSites:250,sites:[],completionApprovals:{}};
 const add=(count:number,kind:string,payment?:string)=>{for(let i=0;i<count;i++){const orderNumber=`${r.sites.length+1}/250`;r.sites.push({orderNumber,...(kind==='unknown'?{}:{recoveryStatus:{paymentStatus:payment,deliveryStatus:'Delivered',installationStatus:kind==='review'?'Review needed':kind==='closed'?'Completed':'Pending'}})});if(kind==='closed')r.completionApprovals[orderNumber]={status:'Approved closed'};}};
 add(86,'closed','Received');add(17,'closed','Pending');add(4,'pending','Received');add(7,'pending','Pending');add(1,'review','Received');add(24,'unknown');
 const s=upsBatchProgress(r);assert.equal(s.listedSites,139);assert.equal(s.completed,103);assert.equal(s.installationPending,11);assert.equal(s.reviewRequired,1);assert.equal(s.unverified,24);assert.equal(s.notDelivered,0);assert.equal(s.remainingToComplete,36);assert.equal(s.notListed,111);assert.equal(s.completedReceived+s.completedPending+s.deliveredReceived+s.deliveredPending+s.reviewRequired+s.unverified,139);
});
test('closure alone does not establish payment and existing alerts keep conflicting evidence under review',()=>{
 const s=upsBatchProgress({totalSites:3,sites:[{orderNumber:'1/3'},{orderNumber:'2/3',recoveryStatus:{deliveryStatus:'Delivered',installationStatus:'Pending',paymentStatus:'Received'}},{orderNumber:'3/3'}],completionApprovals:{'1/3':{}},installationAlerts:{'2/3':{status:'Review needed by Accounts'}}});assert.equal(s.completedPaymentUnknown,1);assert.equal(s.reviewRequired,1);assert.equal(s.unverified,1);assert.equal(s.completedReceived,0);assert.equal(s.deliveredReceived,0);
});
test('cable receipts never settle system balances and the advance remains separate',()=>{
 const s=upsBatchProgress({totalSites:1,progressEvidenceSource:{advancePercent:50},sites:[{orderNumber:'1/1',recoveryStatus:{systemPaymentStatus:'Unverified',paymentStatus:'Received',systemInvoices:[],extraCableInvoices:[{amount:'12000.00',paymentReceived:true},{amount:'3000.00',paymentReceived:false}]}}],completionApprovals:{'1/1':{}}});assert.equal(s.completedPaymentUnknown,1);assert.equal(s.systemReceivedAfterAdvance,'0.00');assert.equal(s.extraCableInvoices,2);assert.equal(s.extraCablePaid,'12000.00');assert.equal(s.extraCableBalance,'3000.00');assert.equal(s.advancePercent,50);
});
test('Management-confirmed completion overlaps data required without inventing payment receipts',()=>{
 const s=upsBatchProgress({totalSites:250,sites:[{orderNumber:'65/250',recoveryStatus:{deliveryStatus:'Delivered',installationStatus:'Completed',systemPaymentStatus:'Unverified',dataRequired:{fields:['Recovery record','Installation date','Remaining payment']}}}],completionConfirmations:{'65/250':{status:'Completed',completionDate:null}}});assert.equal(s.completed,1);assert.equal(s.delivered,0);assert.equal(s.dataRequired,1);assert.equal(s.unverified,0);assert.equal(s.completedPaymentUnknown,1);assert.equal(s.completedSystemReceivedAfterAdvance,'0.00');
});
