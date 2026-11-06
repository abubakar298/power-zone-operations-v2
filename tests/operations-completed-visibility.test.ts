import {test} from 'node:test';
import assert from 'node:assert/strict';
import {showOperationsSite} from '../shared/operations-site-visibility.js';
import {archivedLegacySolarKeys} from '../shared/legacy-solar-archive.js';
test('completion retains UPS and delivery-only sites; only reviewed legacy Solar identities are archived',()=>{
 for(const id of ['165/250','177/250','180/250','185/250','5/250'])for(const completed of [false,true])assert.equal(showOperationsSite({id:'registered-UBL:UPS:'+id,stage:'delivered',completed,projectType:'ups',installation:true}),true);
 assert.equal(showOperationsSite({id:'live-CHP-350',stage:'delivered',completed:true,projectType:'delivery-only',installation:false}),true);
 for(const id of archivedLegacySolarKeys)assert.equal(showOperationsSite({id:'registered-'+id,stage:'completed',completed:true,projectType:'solar-bess',installation:true}),false);
 assert.equal(showOperationsSite({id:'registered-UBL:SOLAR:315',program:'Solar 70',stage:'completed',completed:true,installation:true}),true);
});
