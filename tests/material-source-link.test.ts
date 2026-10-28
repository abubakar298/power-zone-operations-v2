import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkMaterialSourceLink,type IssuedMaterialIdentity} from '../server/inventory/source-link-policy.js';
const site={id:'registered-1',ipo:'CHP-163 · 142/250',name:'Test branch',customerPo:'PO-142',stage:'received'};
const ipo:IssuedMaterialIdentity={id:'actual-142',number:'CHP-163',orderNumber:'142/250',poNumber:'PO-142',siteName:'Test branch'};
test('shared IPO number needs the exact site order, PO and site identity',()=>{
 assert.deepEqual(checkMaterialSourceLink(site,[{...ipo,id:'other',orderNumber:'143/250'},ipo]),{status:'eligible',ipoId:'actual-142'});
 assert.equal(checkMaterialSourceLink(site,[{...ipo,orderNumber:'143/250'}]).status,'missing-ipo');
 assert.equal(checkMaterialSourceLink(site,[ipo,{...ipo,id:'duplicate'}]).status,'ambiguous-ipo');
 assert.equal(checkMaterialSourceLink(site,[{...ipo,poNumber:'PO-143'}]).status,'po-mismatch');
 assert.equal(checkMaterialSourceLink({...site,name:'Different branch'},[ipo]).status,'site-name-review');
});
test('blank matching PO values never establish identity and completed/sample sites never become issuable',()=>{
 assert.equal(checkMaterialSourceLink({...site,customerPo:''},[{...ipo,poNumber:''}]).status,'missing-po');
 for(const patch of [{completed:true},{sample:true},{stage:'delivered'},{stage:'completed'}])assert.equal(checkMaterialSourceLink({...site,...patch},[ipo]).status,'not-pending');
});
test('ordinary whitespace and case differences retain identity without fuzzy branch matching',()=>{
 assert.equal(checkMaterialSourceLink({...site,name:' TEST  branch ',customerPo:'po-142'},[ipo]).status,'eligible');
 assert.equal(checkMaterialSourceLink({...site,name:'Test branch, Lahore'},[ipo]).status,'site-name-review');
});

test('existing installation dispatch continuation retains exact identity and never reopens completed sites',()=>{
 assert.equal(checkMaterialSourceLink({...site,stage:'delivered'},[ipo],true).status,'eligible');
 for(const patch of [{stage:'completed'},{stage:'delivered',completed:true},{stage:'delivered',sample:true}])assert.equal(checkMaterialSourceLink({...site,...patch},[ipo],true).status,'not-pending');
 assert.equal(checkMaterialSourceLink({...site,stage:'delivered'},[{...ipo,poNumber:'CANCELLED-OTHER'}],true).status,'po-mismatch');
});

test('cancelled, transferred, archived and superseded source positions cannot use installation continuation',()=>{
 for(const flag of ['cancelled','transferred','archived','superseded'])for(const stage of ['received','awaiting','delivered'])assert.equal(checkMaterialSourceLink({...site,stage,[flag]:true},[ipo],true).status,'not-pending');
});
