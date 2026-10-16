import test from 'node:test';
import assert from 'node:assert/strict';
import {upsBatchProgress} from '../server/director/ups-progress.js';

const now=new Date('2026-10-16T20:00:00Z'); // 17 October in Karachi.
const site=(n:number,date?:string)=>({orderNumber:`${n}/250`,siteName:`Site ${n}`,recoveryStatus:{deliveryStatus:'Delivered',installationStatus:'Pending',recoveryEvidence:date?[{delivery:date}]:[]}});
test('delivery ageing uses Karachi calendar days and exact agreed band boundaries',()=>{
 const dates=['2026-10-17','2026-10-10','2026-10-09','2026-10-03','2026-10-02','2026-09-17','2026-09-16'];
 const s=upsBatchProgress({totalSites:250,sites:dates.map((d,i)=>site(i+1,d))},now);
 assert.equal(s.deliveryAgeingAsOf,'2026-10-17');
 assert.deepEqual(s.deliveryAgeing.map(r=>[r.days,r.band]),[[0,'0-7'],[7,'0-7'],[8,'8-14'],[14,'8-14'],[15,'15-30'],[30,'15-30'],[31,'31+']]);
});
test('only confirmed delivered installation-pending sites appear regardless of payment',()=>{
 const sites=[site(1,'2026-10-01'),site(2,'2026-10-01'),site(3,'2026-10-01'),site(4,'2026-10-01'),site(5,'2026-10-01')];
 const s=upsBatchProgress({totalSites:250,sites,completionApprovals:{'1/250':{}},completionConfirmations:{'2/250':{}},installationAlerts:{'3/250':{status:'Review needed by Accounts'}}},now);
 assert.deepEqual(s.deliveryAgeing.map(r=>r.orderNumber),['4/250','5/250']);assert.equal(s.deliveryAgeing.length,s.delivered);
 const closed=upsBatchProgress({totalSites:250,sites,completionApprovals:Object.fromEntries(sites.map(r=>[r.orderNumber,{}]))},now);assert.equal(closed.deliveryAgeing.length,0);
});
test('missing, conflicting, invalid and future dates remain unknown; confirmed alert date takes priority',()=>{
 const sites=[site(1),site(2,'2026-02-30'),site(3,'2026-10-18'),site(4,'2026-09-01'),site(5,'2026-09-01')];
 sites[3].recoveryStatus.recoveryEvidence.push({delivery:'2026-09-02'});
 const s=upsBatchProgress({totalSites:250,sites,installationAlerts:{'5/250':{deliveryDate:'2026-10-10'}}},now);
 assert.deepEqual(s.deliveryAgeing.map(r=>r.band),['unknown','unknown','unknown','unknown','0-7']);assert.equal(s.deliveryAgeing[4].days,7);
});
test('awaiting delivery ages from IPO sharing, never PO or invoice dates; review stays separate',()=>{
 const sites=[{orderNumber:'1/250',ipoSharedAt:'2026-10-09T20:00:00Z',recoveryStatus:{deliveryStatus:'Not delivered'}},{orderNumber:'2/250',invoiceDate:'2026-01-01',recoveryStatus:{deliveryStatus:'Not delivered'}},{orderNumber:'3/250',recoveryStatus:{deliveryStatus:'Not delivered'}},site(4,'2026-10-01'),{orderNumber:'5/250'}];
 const s=upsBatchProgress({totalSites:250,sites,installationAlerts:{'3/250':{status:'Review needed by Accounts'}}},now);
 assert.equal(s.awaitingDeliveryAgeing.length,2);assert.equal(s.awaitingDeliveryAgeing[0].days,7);assert.equal(s.awaitingDeliveryAgeing[0].ipoSharedDate,'2026-10-10');assert.equal(s.awaitingDeliveryAgeing[1].band,'unknown');assert.equal(s.notDelivered,2);assert.equal(s.reviewRequired,1);assert.equal(s.unverified,1);
});

test('delay responsibility uses explicit evidence and never guesses PZ from payment or ageing',()=>{
 const first=site(25,'2026-04-28'),second=site(74,'2026-07-11'),third=site(90,'2026-07-29');
 const s=upsBatchProgress({customer:'UBL',totalSites:250,sites:[first,second,third],installationAlerts:{'25/250':{reason:'Branch under construction'}}},now);
 assert.deepEqual(s.deliveryAgeing.map(r=>r.delayOwner),['UBL','UBL','Unclassified']);assert.equal(s.deliveryAgeing[0].delayReason,'Branch under construction');
 const explicit=upsBatchProgress({customer:'MBL',totalSites:250,sites:[{...third,recoveryStatus:{...third.recoveryStatus,delayOwner:'PZ',delayReason:'Awaiting installation team'}}]},now);
 assert.equal(explicit.deliveryAgeing[0].delayOwner,'PZ');assert.equal(explicit.deliveryAgeing[0].delayReason,'Awaiting installation team');
});
