import {test} from 'node:test';
import assert from 'node:assert/strict';
import {plannedInventoryDelivery} from '../server/operations-board/batch-delivery.js';
test('Inventory projects only delivery stops, keeps legacy dates and never uses another site stop',()=>{
 const batch={kind:'both',stops:[{siteId:'installed',kind:'labour',plannedDate:'2026-11-01'},{siteId:'delivery',kind:'delivery',plannedDate:'2026-11-02'},{siteId:'both',kind:'both',plannedDate:'2026-11-03'}]};
 assert.equal(plannedInventoryDelivery({id:'installed',planningBatches:[batch]}),null);
 assert.equal(plannedInventoryDelivery({id:'delivery',planningBatches:[batch]}),'2026-11-02');
 assert.equal(plannedInventoryDelivery({id:'both',planningBatches:[batch]}),'2026-11-03');
 assert.equal(plannedInventoryDelivery({id:'missing',planningBatches:[batch]}),null);
 assert.equal(plannedInventoryDelivery({id:'legacy',dispatchDate:'2026-10-30'}),'2026-10-30');
 assert.equal(plannedInventoryDelivery({id:'legacy',planningBatches:[{kind:'delivery',stops:[{siteId:'legacy',plannedDate:'2026-11-04'}]}]}),'2026-11-04');
});
