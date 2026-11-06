import {test} from 'node:test';
import assert from 'node:assert/strict';
import {siteUsageEvidenceHolds} from '../server/inventory/material-usage.js';
const row={key:'row',itemId:'CH-THIMBLE-16MM',description:'16mm thimbles',warehouseOut:'35',sites:['a','b']};
const reports=[{site_id:'a',snapshot:{state:'signed',lines:[{lineKey:'row',issued:'20',used:'18',returned:'2'}]}},{site_id:'b',snapshot:{state:'signed',lines:[{lineKey:'row',issued:'15',used:'12',returned:'3'}]}}];
test('parent miscellaneous allocation and return arithmetic remain independent of balanced warehouse totals',()=>{
 assert.deepEqual(siteUsageEvidenceHolds(row,true,reports),[]);
 const bad=structuredClone(reports);bad[0].snapshot.lines[0].returned='1';assert.deepEqual(siteUsageEvidenceHolds(row,true,bad),['IRR correction needed']);
 const unknown=structuredClone(reports) as any;unknown[0].snapshot.lines[0].issued=null;assert.deepEqual(siteUsageEvidenceHolds(row,true,unknown),['Site issued allocation pending']);
 unknown[0].snapshot.lines[0].issued='20';unknown[0].snapshot.lines[0].returned=null;assert.deepEqual(siteUsageEvidenceHolds(row,true,unknown),['Internal return quantity pending']);
 unknown[0].snapshot.lines[0].used='20';assert.deepEqual(siteUsageEvidenceHolds(row,true,unknown),[],'No return due needs no invented site return.');
});
test('signed evidence and single-site issuance discrepancies cannot be hidden by a balanced pool',()=>{
 const pending=structuredClone(reports);pending[1].snapshot.state='reported';assert.deepEqual(siteUsageEvidenceHolds(row,true,pending),['Site sign-off evidence pending']);
 assert.deepEqual(siteUsageEvidenceHolds({...row,sites:['a']},false,reports),['Site issued quantity needs reconciliation']);
 const cable={...row,itemId:'CH-CBL-AC-16MM/4C-PK',description:'AC cable'};const measured=structuredClone(reports) as any;measured[0].snapshot.lines[0].issued=null;measured[0].snapshot.lines[0].returned=null;assert.deepEqual(siteUsageEvidenceHolds(cable,true,measured),[],'Customer cables use measured use; site-stated returns are not required on customer sign-off.');
});
