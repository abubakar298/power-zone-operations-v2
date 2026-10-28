import {test} from 'node:test';import assert from 'node:assert/strict';import {applyOperationsStages,projectAccountsSites} from '../server/accounts/site-projection.js';
test('current delivery and full-return stages replace stale display values without rewriting original source or payment evidence',()=>{
 const rows=[{key:'delivered',delivered:false,installed:false},{key:'returned',delivered:true,installed:false,deliveryDate:'2026-10-15'}];const before=structuredClone(rows);
 const operations=[{site_id:'registered-delivered',version:7,created_at:'2026-10-28',snapshot:{stage:'delivered',completed:false,partial:false,deliveryDate:'2026-10-27'}},{site_id:'registered-returned',version:7,created_at:'2026-10-28',snapshot:{stage:'received',completed:false,partial:false}}];
 const result=applyOperationsStages(rows,operations);assert.equal(result[0].delivered,true);assert.equal(result[1].delivered,false);assert.equal(result[1].deliveryDate,null);assert.deepEqual(rows,before);
 const snapshot={sites:{rows,counts:{}},registers:[{rows:[{key:'delivered',completion:{received:true,receivedAmount:'100.25'},invoiceReferences:['27-10123']}]}]};const displayed=projectAccountsSites(snapshot,operations);
 assert.equal(displayed.rows[0].completion.received,true);assert.equal(displayed.counts.delivered,1);assert.equal(displayed.counts.awaiting,1);assert.equal(snapshot.sites.rows[0].completion,undefined);
});
test('ambiguous, unknown and cancelled source stages are not silently replaced',()=>{
 const rows=[{key:'x',delivered:true},{key:'y',cancelled:true,delivered:true}];
 assert.deepEqual(applyOperationsStages(rows,[{site_id:'registered-x',version:1,snapshot:{stage:null}},{site_id:'registered-y',version:1,snapshot:{stage:'received'}}]),rows);
 assert.deepEqual(applyOperationsStages(rows,[{site_id:'a',snapshot:{sourceKey:'x',stage:'received'}},{site_id:'b',snapshot:{sourceKey:'x',stage:'delivered'}}]),rows);
});
