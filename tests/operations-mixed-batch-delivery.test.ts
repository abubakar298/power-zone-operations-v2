import {test} from 'node:test';
import assert from 'node:assert/strict';
import {plannedInventoryDelivery,plannedInventoryInstallation} from '../server/operations-board/batch-delivery.js';
test('Inventory projects only delivery stops, keeps legacy dates and never uses another site stop',()=>{
 const batch={kind:'both',stops:[{siteId:'installed',kind:'labour',plannedDate:'2026-11-01'},{siteId:'delivery',kind:'delivery',plannedDate:'2026-11-02'},{siteId:'both',kind:'both',plannedDate:'2026-11-03'}]};
 assert.equal(plannedInventoryDelivery({id:'installed',planningBatches:[batch]}),null);
 assert.equal(plannedInventoryDelivery({id:'delivery',planningBatches:[batch]}),'2026-11-02');
 assert.equal(plannedInventoryDelivery({id:'both',planningBatches:[batch]}),'2026-11-03');
 assert.equal(plannedInventoryDelivery({id:'missing',planningBatches:[batch]}),null);
 assert.equal(plannedInventoryDelivery({id:'legacy',installation:false,dispatchDate:'2026-10-30'}),'2026-10-30');
 assert.equal(plannedInventoryDelivery({id:'legacy',planningBatches:[{kind:'delivery',stops:[{siteId:'legacy',plannedDate:'2026-11-04'}]}]}),'2026-11-04');
});

test('an installation target is not a material dispatch, while delivery routes retain their exact dates',()=>{
 const site={id:'ups',installation:true,dispatchDate:'2026-11-05'};
 assert.equal(plannedInventoryDelivery(site),null);assert.equal(plannedInventoryInstallation(site),'2026-11-05');
 assert.equal(plannedInventoryDelivery({...site,planningBatches:[{kind:'labour',stops:[{siteId:'ups',plannedDate:'2026-11-06'}]}]}),null);
 assert.equal(plannedInventoryDelivery({...site,planningBatches:[{kind:'both',stops:[{siteId:'ups',plannedDate:'2026-11-04'}]}]}),'2026-11-04');
 assert.equal(plannedInventoryInstallation({...site,installationPlanDate:'2026-11-05',dispatchDate:'2026-11-04'}),'2026-11-05');
});
