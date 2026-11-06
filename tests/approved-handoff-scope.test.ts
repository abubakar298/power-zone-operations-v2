import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedHandoffScope} from '../server/operations-board/live-ipo-sync.js';
test('scope fallback uses only the exact saved approved BOQ family and preserves explicit human choices',()=>{
 const legacy={scope:null,siteType:'BESS',humanSiteType:false},basis=(family:string)=>({id:'same',snapshot:{survey:{family}}});
 assert.equal(approvedHandoffScope('same','same',basis('bess-only'),legacy)?.scope,'installation');assert.equal(approvedHandoffScope('same','same',basis('bess-only'),legacy)?.siteType,'UPS');
 assert.equal(approvedHandoffScope('same','same',basis('solar-hybrid'),legacy)?.siteType,'Solar + BESS');assert.equal(approvedHandoffScope('same','same',basis('direct-product'),legacy)?.scope,'delivery_only');
 assert.equal(approvedHandoffScope('same','same',basis('bess-only'),{...legacy,humanSiteType:true})?.siteType,'BESS');
 assert.equal(approvedHandoffScope('same','same',basis('bess-only'),{...legacy,scope:'delivery_only'}),null);
 assert.equal(approvedHandoffScope('same','different',basis('bess-only'),legacy),null);assert.equal(approvedHandoffScope('same','same',{id:'other',snapshot:{survey:{family:'bess-only'}}},legacy),null);
 assert.equal(approvedHandoffScope('same','same',basis('unknown'),legacy),null);assert.equal(approvedHandoffScope('same','same',null,legacy),null);
});
