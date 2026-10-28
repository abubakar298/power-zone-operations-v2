import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsNotificationPolicy as decide,operationsNotificationStart,operationsIncidentId,type OperationsNotificationInput} from '../shared/operations-notification-policy.js';
const base:OperationsNotificationInput={siteId:'site-a',stageKey:'ups:job',occurrenceKey:'delivery-version-4',now:'2026-10-27T01:00:00Z',start:{recordedAt:'2026-10-27T00:00:00Z'},target:{amount:1,unit:'hours'},completed:false,documentsSubmittedToAccounts:false,recipients:{assigned:'qc-central',lead:'central-lead',management:'owner'}};
const recipients=(v:OperationsNotificationInput)=>decide(v).eligible.map(r=>r.recipientId);
test('stage periods notify assigned at target, lead one period later, Management two periods later',()=>{
 assert.deepEqual(recipients({...base,now:'2026-10-27T00:59:59.999Z'}),[]);assert.deepEqual(recipients(base),['qc-central']);
 assert.deepEqual(recipients({...base,now:'2026-10-27T02:00:00Z'}),['qc-central','central-lead']);
 const final=decide({...base,now:'2026-10-27T03:00:00Z'});
 assert.deepEqual(final.eligible.map(r=>r.dueAt),['2026-10-27T01:00:00.000Z','2026-10-27T02:00:00.000Z','2026-10-27T03:00:00.000Z']);
 assert.deepEqual(final.eligible.map(r=>r.recipientId),['qc-central','central-lead','owner']);
 assert.equal(decide({...base,start:{recordedAt:'2026-10-24T00:00:00Z'},target:{amount:1,unit:'days'},now:'2026-10-27T00:00:00Z'}).eligible.length,3);
});
test('date-only uses Pakistan day end; impossible/timezone-free/missing clocks hold',()=>{
 assert.equal(operationsNotificationStart({date:'2026-10-26'})?.at,Date.parse('2026-10-26T23:59:59+05:00'));
 for(const start of [undefined,null,{date:'2026-02-30'},{date:'27/10/2026'},{recordedAt:'2026-10-27T00:00:00'},{recordedAt:'2026-02-30T00:00:00Z'},{recordedAt:'2026-10-27T25:00:00Z'},{recordedAt:'bad',date:'2026-10-26'}]){
  const result=decide({...base,start});assert.equal(result.eligible.length,0);assert.equal(result.deadline,null);assert.ok(result.holds.includes('Stage start is missing or invalid.'));
 }
 const date=decide({...base,start:{date:'2026-10-26'},now:'2026-10-26T19:59:59Z'});assert.equal(date.basis,'date-only');assert.equal(date.eligible.length,1);
 for(const now of ['bad','2026-10-27','2026-02-30T01:00:00Z'])assert.deepEqual(recipients({...base,now,openBlockerIds:['blocker']}),[]);
 assert.equal(decide({...base,start:{recordedAt:'2026-10-28T00:00:00Z'}}).deadline,null);
});
test('unknown invalid targets never invent a default; missing recipients hold only their explicit tier',()=>{
 for(const target of [null,undefined,{amount:0,unit:'hours' as const},{amount:-1,unit:'days' as const},{amount:NaN,unit:'hours' as const},{amount:Infinity,unit:'days' as const},{amount:1e100,unit:'days' as const}]){
  const result=decide({...base,target});assert.equal(result.eligible.length,0);assert.equal(result.deadline,null);assert.ok(result.holds.length);
 }
 assert.equal(decide({...base,recipients:{lead:'central-lead'},now:'2026-10-27T02:00:00Z'}).eligible[0].recipientId,'central-lead');
 assert.ok(decide({...base,recipients:{}}).holds.includes('Reviewed assigned recipient is missing.'));
});
test('completed plus Accounts-submitted suppresses; missing document submission is not inferred',()=>{
 const done=decide({...base,completed:true,documentsSubmittedToAccounts:true,openBlockerIds:['blocked']});assert.equal(done.suppressed,true);assert.deepEqual(done.eligible,[]);
 assert.equal(decide({...base,completed:true,documentsSubmittedToAccounts:false}).suppressed,false);
 assert.equal(decide({...base,completed:false,documentsSubmittedToAccounts:true}).suppressed,false);
});
test('identity survives target edits/blocker enrichment; actual stage re-entry requires distinct occurrence',()=>{
 const old=decide(base),enriched=decide({...base,target:{amount:3,unit:'days'},now:'2026-10-28T00:00:00Z',openBlockerIds:['b2','b1','b1']});
 assert.equal(old.incidentId,enriched.incidentId);assert.deepEqual(enriched.blockerIds,['b1','b2']);assert.equal(enriched.eligible.length,3);assert.equal(old.eligible[0].key,enriched.eligible[0].key);
 assert.notEqual(old.incidentId,decide({...base,occurrenceKey:'new-stage-entry'}).incidentId);
 assert.notEqual(operationsIncidentId('a:b','c','d'),operationsIncidentId('a','b:c','d'));
 assert.equal(decide({...base,occurrenceKey:'',openBlockerIds:['b']}).eligible.length,0);
});
test('delay then blocker reserves each person once; queued retries retain that reservation',()=>{
 const first=decide(base),receipts=first.eligible.map(({incidentId,recipientId})=>({incidentId,recipientId}));
 const blocked=decide({...base,openBlockerIds:['customer-not-ready'],receipts});assert.deepEqual(blocked.eligible.map(r=>r.recipientId),['central-lead','owner']);
 const all=[...receipts,...blocked.eligible.map(({incidentId,recipientId})=>({incidentId,recipientId}))];
 assert.deepEqual(recipients({...base,openBlockerIds:['second-reason'],receipts:all,now:'2026-10-28T00:00:00Z'}),[]);
 assert.deepEqual(recipients({...base,receipts:[{incidentId:'another-occurrence',recipientId:'qc-central'}]}),['qc-central']);
 assert.equal(decide({...base,openBlockerIds:['b'],recipients:{assigned:'same-person',lead:'same-person',management:'same-person'}}).eligible.length,1);
});
test('known blockers alert explicit recipients immediately without fabricating missing stage dates',()=>{
 const result=decide({...base,start:null,target:null,now:'2026-10-27T00:00:00Z',openBlockerIds:['b']});
 assert.equal(result.deadline,null);assert.ok(result.holds.includes('Stage start is missing or invalid.'));assert.equal(result.eligible.length,3);assert.ok(result.eligible.every(r=>r.trigger==='blocker'&&r.dueAt==='2026-10-27T00:00:00.000Z'));
 assert.deepEqual(recipients({...base,start:null,openBlockerIds:['b'],recipients:{}}),[]);
});
