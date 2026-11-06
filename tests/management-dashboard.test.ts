import {test} from 'node:test';
import assert from 'node:assert/strict';
import {upsDashboardSummary} from '../web/workspaces/management-dashboard.js';
import {upsActiveRegister} from '../server/director/ups-register.js';

test('Management dashboard uses merged IPO identities; completion is independent of payment and delivery',()=>{
 const program={program_key:'UBL-250',version:1,snapshot:{managementRegister:{customer:'UBL',projectReference:'CHP-163',configuration:'6-10',totalSites:250,source:{filename:'register.xlsx'},sites:[
  {orderNumber:'1/250',siteName:'Installed, unpaid',recoveryStatus:{deliveryStatus:'Delivered',installationStatus:'Pending',paymentStatus:'Pending'}},
  {orderNumber:'2/250',siteName:'Delivered only',recoveryStatus:{deliveryStatus:'Delivered',installationStatus:'Pending'}},
  {orderNumber:'3/250',siteName:'Completion approved',recoveryStatus:{paymentStatus:'Received'}},
  {orderNumber:'4/250',siteName:'Evidence needs review',recoveryStatus:{deliveryStatus:'Delivered',installationStatus:'Review needed'}},
 ],completionConfirmations:{'1/250':{completionDate:'2026-10-24'}},completionApprovals:{'3/250':{completionDate:'2026-10-23'}}}}};
 const register=upsActiveRegister([program],[{id:'issued-1',number:'CHP-163',configuration:'6-10',orderNumber:'1/250',site:'Installed, unpaid',issuedAt:'2026-10-01'}]);
 assert.deepEqual(upsDashboardSummary({register}),{received:4,installed:2,completionUnconfirmed:2});
 assert.equal(register.rows.filter(r=>r.ipoId==='issued-1').length,1,'An imported site linked to a later issuance must not count twice');
 assert.deepEqual(upsDashboardSummary({register:{rows:[]}}),{received:0,installed:0,completionUnconfirmed:0});
});
