import {test} from 'node:test';
import assert from 'node:assert/strict';
import {programmeNavigation,programmeNavigationHash} from '../shared/programme-navigation.js';
const choices=['ubl-ups-250','ubl-solar-70','mbl-ups-80','mbl-ups-20','mbl-ups-60','all-ups'];
test('programme, bucket and search survive refresh without losing other workspace fields',()=>{
 const state={programme:'mbl-ups-20',bucket:'paymentPending',search:'PO & branch #1'};
 const hash=programmeNavigationHash('#workspace=dashboard&viewAs=Management',state);
 assert.deepEqual(programmeNavigation(hash,choices),state);assert.equal(new URLSearchParams(hash.slice(1)).get('viewAs'),'Management');
 const reset=programmeNavigationHash(hash,{programme:'ubl-ups-250',bucket:'active',search:''});assert.ok(!reset.includes('programmeBucket'));assert.ok(!reset.includes('programmeSearch'));
});
test('unknown programme and bucket safely reset; overlong search is bounded',()=>{
 assert.deepEqual(programmeNavigation('#programme=evil&programmeBucket=__proto__',choices),{programme:'ubl-ups-250',bucket:'active',search:''});
 assert.equal(programmeNavigation('#programmeSearch='+encodeURIComponent('a'.repeat(400)),choices).search.length,200);
});

test('Accounts programme filters retain the finance workspace and selected Accounts page',()=>{
 const hash=programmeNavigationHash('#workspace=finance&accountsTab=Programme+Dashboard&viewAs=Accounts',{programme:'mbl-ups-60',bucket:'pendingDelivery',search:'Branch'});
 const params=new URLSearchParams(hash.slice(1));assert.equal(params.get('workspace'),'finance');assert.equal(params.get('accountsTab'),'Programme Dashboard');assert.equal(params.get('viewAs'),'Accounts');
});

test('Management project tracking remains on its view-only workspace while filtering',()=>{
 const expected={programme:'ubl-solar-70',bucket:'pendingDelivery',search:'Branch'};
 const hash=programmeNavigationHash('#workspace=project-tracking',expected);
 assert.equal(new URLSearchParams(hash.slice(1)).get('workspace'),'project-tracking');assert.deepEqual(programmeNavigation(hash,choices),expected);
});
