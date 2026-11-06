import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parentPoolLines} from '../shared/parent-material-pool.js';
import {variablePreparationRows} from '../shared/material-preparation.js';
import {parentDraftPrintModel,issuedCustomerSignoffModels,issuedDispatchPrintModel} from '../server/inventory/material-document-model.js';
const sites=[{siteId:'mansehra',siteName:'Mansehra',ipo:'CHP-M',installation:true},{siteId:'choot',siteName:'Choot Dheeran',ipo:'CHP-C',installation:true}];
const lines=[{key:'pk',itemId:'CH-CBL-ERT-2.5MM/1C-PK',description:'ERT 2.5MM 1C PK',unit:'m',out:'80',sites:['mansehra']},{key:'local',itemId:'CH-CBL-ERT-2.5MM/1C-LCL',description:'ERT 2.5MM 1C LCL',unit:'m',out:'90',sites:['mansehra','choot']}];
const snapshot={parent:true,kind:'variable' as const,warehouse:'Lahore warehouse',sites,lines,stockPosting:false};
test('all Parent pool variables are available to every covered site without changing original allocations or amounts',()=>{
 const before=structuredClone(snapshot),resolved=parentPoolLines(snapshot);
 assert.deepEqual(resolved[0].sites,['mansehra','choot']);assert.equal(resolved[0].out,'80');assert.deepEqual(snapshot,before);
 assert.equal(parentPoolLines({...snapshot,parent:false}),snapshot.lines,'Individual DO allocations stay unchanged.');
 assert.ok(resolved.every(r=>!r.sites.includes('unrelated')));
});
test('existing Parent VSO includes Pakistan cable for every site, with no site-issued allocation or duplicate warehouse OUT',()=>{
 const draft={id:'parent',version:1,snapshot},before=structuredClone(draft);
 const signoff=parentDraftPrintModel(draft,'customer-signoff','choot');assert.deepEqual(signoff.rows.map(r=>r.itemId),lines.map(l=>l.itemId));assert.ok(signoff.rows.every(r=>r.issued===null));assert.equal(signoff.stockPosting,false);
 const record={id:'dispatch',number:'PDO-0001',created_at:'2026-10-30T12:00:00Z',snapshot:{...snapshot,status:'issued',stockPosting:true}};
 const models=issuedCustomerSignoffModels(record);assert.equal(models.length,2);assert.ok(models.every(model=>model.rows.some(r=>r.itemId===lines[0].itemId)));assert.ok(models.every(model=>model.rows.every(r=>r.issued===null)));
 const physical=issuedDispatchPrintModel(record);assert.equal(physical.rows.find(r=>r.itemId===lines[0].itemId)?.issued,'80');assert.equal(physical.rows.length,2);assert.deepEqual(draft,before);
});
test('new Parent preparation does not inherit per-BOQ exclusions for a Pakistan cable pool',()=>{
 const sources=sites.map((s,index)=>({...s,customer:'UBL',items:index===0?[{key:lines[0].itemId,description:lines[0].description,unit:'m',qty:'80'}]:[]}));
 const prepared=variablePreparationRows(sources,[{itemId:lines[0].itemId,description:lines[0].description,units:['m']}],()=> 'key');assert.equal(prepared.length,1);assert.deepEqual(prepared[0].sites,['mansehra','choot']);assert.equal(prepared[0].out,'');
});
