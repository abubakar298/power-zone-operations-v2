import {test} from 'node:test';
import assert from 'node:assert/strict';
import {showOperationsSite} from '../shared/operations-site-visibility.js';
test('active Operations hides legacy and completed work except UBL Solar, without changing records',()=>{
 const site={id:'site',stage:'delivered',installation:true,completed:true,customer:'UBL',projectType:'solar-bess'};
 assert.equal(showOperationsSite(site),true);
 assert.equal(showOperationsSite({...site,program:'Solar legacy'}),false);
 assert.equal(showOperationsSite({...site,projectType:'ups'}),false);
 assert.equal(showOperationsSite({...site,customer:'Meezan Bank Limited'}),false);
 assert.equal(showOperationsSite({...site,customer:'United Bank Limited'}),true);
 assert.equal(showOperationsSite({...site,completed:false,stage:'awaiting',customer:'Meezan Bank Limited'}),true);
 assert.equal(showOperationsSite({...site,completed:false,stage:'completed',projectType:'ups'}),false);
 assert.equal(showOperationsSite({...site,completed:false,qc:{signoff:{date:'2026-10-28'}},projectType:'ups'}),false);
 assert.equal(site.completed,true);
});
