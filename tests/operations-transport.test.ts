import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scheduledTransport} from '../shared/operations-transport.js';
import type {InventoryBatch} from '../server/inventory/operations-batches.js';
const route=(id:string,siteIds:string[],vehicle='LHR-123',driver='Driver A'):InventoryBatch=>({id,number:id,version:1,team:'central',vehicle,driver,stops:siteIds.map(siteId=>({siteId,boardSiteId:siteId,name:siteId,ipo:siteId,date:'2026-11-02',work:'both',status:'ready'}))});
test('individual and Parent DO inherit their single current Operations route; dispatch override leaves route unchanged',()=>{
 const batch=route('B1',['a','b']),before=JSON.stringify(batch);
 assert.equal(scheduledTransport([batch],['a'])?.transport.vehicle,'LHR-123');
 const parent=scheduledTransport([batch],['a','b']);assert.equal(parent?.transport.driver,'Driver A');
 parent!.transport.driver='Dispatch replacement';parent!.transport.vehicle='LHR-999';
 assert.equal(JSON.stringify(batch),before);
 assert.equal(scheduledTransport([batch],['a'])?.transport.driver,'Driver A');
});
test('cancelled/replaced sites use only latest route and ambiguous or mixed routes are never guessed',()=>{
 const current=route('B1',['a','replacement']);
 assert.equal(scheduledTransport([current],['cancelled']),null);
 assert.equal(scheduledTransport([current],['replacement'])?.batchId,'B1');
 assert.equal(scheduledTransport([current,route('B2',['a'])],['a']),null);
 assert.equal(scheduledTransport([current,route('B2',['other'])],['a','other']),null);
 assert.equal(scheduledTransport([],['a']),null);
 assert.equal(scheduledTransport([current],[]),null);
});
