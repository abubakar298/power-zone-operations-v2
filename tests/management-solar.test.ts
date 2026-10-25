import {test} from 'node:test';
import assert from 'node:assert/strict';
import {solarDashboardRows,solarDashboardSummary} from '../web/workspaces/management-solar.js';

test('Solar bucket uses stable site/checkpoint identities, keeps cancellation and revisions separate, and never infers installation from invoicing',()=>{
 const sites=[
  {site_id:1,site_name:'UBL Installed',legacy_ipo_number:320,po_number:'P1',status:'Active'},
  {site_id:2,site_name:'UBL Delivered',legacy_ipo_number:321,po_number:'P2',status:'Active'},
  {site_id:3,site_name:'UBL Partial',legacy_ipo_number:322,po_number:'P3',status:'Active',irr_review_flags:['Review cable quantities']},
  {site_id:4,site_name:'UBL Cancelled',legacy_ipo_number:323,po_number:'P4',status:'Cancelled'},
  {site_id:5,site_name:'UBL Revised PO',legacy_ipo_number:324,po_number:null,status:'Awaiting revised PO'},
  {site_id:6,site_name:'UBL New workflow',legacy_ipo_number:'CHP-325',po_number:'P6',status:'Active',new_workflow_ipo_id:'new-ipo'},
 ];
 const jobs=[
  {key:'ubl:1',operation:{installationStatus:'Installation completed',completionDate:'2026-10-24'}},
  {key:'ubl:2',operation:{installationStatus:'Work in Progress',solarDelivery:'2026-10-22',equipmentDelivery:'2026-10-23'}},
  {key:'ubl:3',operation:{installationStatus:'Work in Progress',solarDelivery:'2026-10-22'}},
  {key:'ubl:4',operation:{installationStatus:'Installation completed'}},
  {key:'ubl:5',operation:{installationStatus:'Installation completed'}},
  {key:'ubl:6',operation:{installationStatus:'Installation completed'}}, // Not this workflow's identity.
  {key:'ipo:new-ipo',operation:{installationStatus:'Awaiting data'}},
  {key:'ipo:unrelated-ups',operation:{installationStatus:'Installation completed'}},
 ];
 const source=JSON.stringify({sites,jobs}),rows=solarDashboardRows([...sites,sites[0]],jobs);
 assert.equal(rows.length,6);assert.deepEqual(solarDashboardSummary(rows),{registered:6,received:5,active:4,installed:1,deliveryUnconfirmed:2,flagged:2,cancelled:1,awaitingRevision:1});
 assert.equal(rows[2].partialDelivery,true);assert.equal(rows[1].installed,false);assert.equal(rows[5].ipo,'CHP-325');assert.equal(rows[5].installed,false);
 assert.equal(JSON.stringify({sites,jobs}),source,'view calculations cannot change saved records');
 assert.deepEqual(solarDashboardSummary([]),{registered:0,received:0,active:0,installed:0,deliveryUnconfirmed:0,flagged:0,cancelled:0,awaitingRevision:0});
});
