import {test} from 'node:test';
import assert from 'node:assert/strict';
import {showOperationsSite} from '../shared/operations-site-visibility.js';
test('Operations retains completed work; only exact legacy archive identities are hidden',()=>{
 const site={id:'site',stage:'delivered',installation:true,completed:true,customer:'UBL',projectType:'solar-bess'};
 assert.equal(showOperationsSite(site),true);
 assert.equal(showOperationsSite({...site,program:'Solar legacy'}),true);
 assert.equal(showOperationsSite({...site,projectType:'ups'}),true);
 assert.equal(showOperationsSite({...site,customer:'Meezan Bank Limited'}),true);
 assert.equal(showOperationsSite({...site,customer:'United Bank Limited'}),true);
 assert.equal(showOperationsSite({...site,completed:false,stage:'awaiting',customer:'Meezan Bank Limited'}),true);
 assert.equal(showOperationsSite({...site,completed:false,stage:'completed',projectType:'ups'}),true);
 assert.equal(showOperationsSite({...site,completed:false,qc:{signoff:{date:'2026-10-28'}},projectType:'ups'}),true);
 assert.equal(site.completed,true);
});
