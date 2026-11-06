import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewQuantities} from '../server/inventory/review-quantities.js';
import {prepareInventoryReview} from '../server/inventory/review-source.js';

const red='CH-CBL-DC-6MM/1C-R/PK',black='CH-CBL-DC-6MM/1C-B/PK';
const catalogue={rows:[{itemId:'AC-FINAL',oldAliases:['AC-OLD']},{itemId:'CH-CBL-COM'},{itemId:red},{itemId:black}],aliases:[{oldId:'CH-CBL-CAT6',finalIds:['CH-CBL-COM']},{oldId:'DC-GENERIC',finalIds:[red,black]}]};
const row=(extra:Record<string,unknown>={})=>({id:'ac16',item:'AC 16mm four core',itemId:'AC-OLD',unit:'m',origin:'warehouse_stock',status:'Reconciled — credit posted',dispatch:130,irrIssued:115,used:96,reportedReturn:26,countedReturn:34,credited:34,stockCorrectionPosted:{checkpoint:'accepted-return',delta:8},...extra});
const source=(rows:ReturnType<typeof row>[])=>({groups:[{id:'bhakkar',title:'Bhakkar',warehouse:'Lahore',rows}]});

test('accepted source credits survive final-ID normalization without replaying quantities or stock',()=>{
 const input=source([row()]),before=structuredClone(input),result=prepareInventoryReview(input,catalogue),line=result.cases[0];
 assert.equal(line.item,'AC-FINAL');assert.equal(line.sourceItemId,'AC-OLD');assert.equal(line.unit,'m');assert.equal(line.description,input.groups[0].rows[0].item);
 assert.deepEqual(line.quantities,{dispatch:'130',irrIssued:'115',used:'96',reportedReturn:'26',countedReturn:'34',expectedReturn:'34',warehouseReturn:'34',credited:'34',returnDifference:'0',creditDifference:'0'});
 assert.equal(line.conclusion,'verified-source');assert.equal(line.stockPosting,'already-recorded-in-source');assert.equal(result.postingEnabled,false);assert.equal(line.postingEnabled,false);assert.deepEqual(input,before);
 line.sourceRow.unit='changed in output';assert.equal(input.groups[0].rows[0].unit,'m');
 const later=prepareInventoryReview(source([row({item:'Longer corrected description'})]),catalogue);assert.equal(later.cases[0].id,line.id);
});
test('merged communication IDs retain product variants and units, while unlabelled DC and missing IDs stay held',()=>{
 const result=prepareInventoryReview(source([row({id:'cat',itemId:'CH-CBL-CAT6',item:'CAT6 network cable',unit:'ft'}),row({id:'red',itemId:'DC-GENERIC',item:'6mm DC Red cable'}),row({id:'combined',itemId:'DC-GENERIC',item:'DC Red and Black combined reels',status:'Provisional colour split — verify later'}),row({id:'missing',itemId:'',item:'Unidentified box',status:'Final ID mapping needs review'})]),catalogue);
 assert.equal(result.cases[0].item,'CH-CBL-COM');assert.equal(result.cases[0].unit,'ft');assert.equal(result.cases[0].description,'CAT6 network cable');
 assert.equal(result.cases[1].item,red);assert.equal(result.cases[2].item,null);assert.equal(result.cases[2].identity.state,'ambiguous');assert.equal(result.cases[2].identityReviewRequired,true);assert.equal(result.cases[2].stockPosting,'already-recorded-in-source');
 assert.equal(result.cases[3].identity.state,'unmapped');assert.equal(result.summary.identityHolds,2);assert.equal(new Set(result.cases.map(c=>c.id)).size,4);
});
test('unknown usage is not zero and a missing nonzero return is never invented',()=>{
 const result=prepareInventoryReview(source([row({id:'unknown',used:null,countedReturn:null,status:'Incomplete evidence'}),row({id:'zero',dispatch:15,used:15,countedReturn:null,credited:0,status:'Reconciled — no return due'}),row({id:'partial',used:10,usagePartial:true,status:'IRR line / quantity needs review'}),row({id:'lp',origin:'LP',status:'LP — reconcile purchase / issue / return once'})]),catalogue);
 assert.equal(result.cases[0].quantities.expectedReturn,null);assert.equal(result.cases[0].quantities.warehouseReturn,null);
 assert.equal(result.cases[1].quantities.warehouseReturn,'0');assert.equal(result.cases[1].conclusion,'verified-source');assert.equal(result.cases[2].quantities.expectedReturn,null);
 assert.equal(result.cases[3].origin,'LP');assert.equal(result.cases[3].conclusion,'needs-review');assert.equal(result.cases[3].quantities.dispatch,'130');assert.equal(result.cases[3].postingEnabled,false);
 assert.throws(()=>prepareInventoryReview(source([row(),row()]),catalogue),/Duplicate reconciliation/);
 assert.throws(()=>prepareInventoryReview(source([row()]),{...catalogue,aliases:[{oldId:'bad',finalIds:['NOT-IN-FINAL-LIST']}]}),/outside the final/);
});

test('ambiguous credit retains verified dispatch/use arithmetic but holds any credit adjustment',()=>{
 const line=prepareInventoryReview(source([row({credited:1,creditAmbiguous:true,status:'Existing credit attribution pending'})]),catalogue).cases[0];
 const projected=reviewQuantities(line);assert.equal(projected.quantities.expectedReturn,'34');assert.equal(projected.quantities.returnDifference,'0');assert.equal(projected.quantities.creditDifference,null);assert.equal(projected.quantities.credited,'1');assert.match(projected.calculationHolds.join(' '),/credit attribution.*held/);
 assert.equal(line.quantities.creditDifference,'33','Read projection does not rewrite frozen source maths');
});
