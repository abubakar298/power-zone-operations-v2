import{test}from'node:test';import assert from'node:assert/strict';import{reviewIssueRows}from'../web/inventory-approved/site-issue-review.js';
test('review shows only additional quantities and keeps a missing ID nonblocking without changing entries',()=>{
 const rows=[{key:'a',itemId:'CH-BAT-HV-05 KW',description:'Battery',unit:'piece',out:'2',sites:['site']},{key:'v',itemId:'',description:'VPD',unit:'piece',out:'1',sites:['site']},{key:'c',itemId:'CH-CBL-AC-16MM/4C-PK',description:'Cable',unit:'m',out:'',sites:['site']}],before=JSON.stringify(rows),result=reviewIssueRows(rows,{a:'1'});
 assert.deepEqual(result.included.map(r=>[r.itemId,r.out]),[['CH-BAT-HV-05 KW','1']]);assert.deepEqual(result.missing,['VPD']);assert.equal(JSON.stringify(rows),before);
 const corrected=reviewIssueRows([...rows,{key:'new',itemId:'CH-VPD-63A/2P',description:'VPD',unit:'piece',out:'1',sites:['site']}],{a:'2'});assert.deepEqual(corrected.included.map(r=>r.itemId),['CH-VPD-63A/2P']);
});
