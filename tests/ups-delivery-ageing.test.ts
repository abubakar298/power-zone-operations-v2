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
