import {test} from 'node:test';
import assert from 'node:assert/strict';
import {price} from '../server/commercial/engine.js';
import {allocateDiscount} from '../server/orders/allocation.js';
import {managementReview} from '../server/commercial/management-review.js';
const boq:any={survey:{family:'solar-hybrid',saleType:'Cash Deal',cashGstTreatment:'Included in selling price'},customer:{name:'Customer'},engineering:{solutionId:'sample'},summary:[{name:'Solar Panels',cost:'100'},{name:'Structure',cost:'100'},{name:'BESS',cost:'100'}],epc:[],lines:[],total:'400'};
const input:any={presentation:'Full Breakup',taxMode:'Show Sales Tax Separately',markups:{solar:'10',structure:'10',bess:'10',earthing:'10',balance:'10',rest:'10'}};
test('cash retained GST-equivalent increases selling and profit without a GST liability',()=>{
 const p=price(boq,'sample',input);
 assert.equal(p.total,'510.40'); assert.equal(p.tax,'0.00'); assert.equal(p.profit,'110.40');
 assert.equal(p.dealAccounting?.retainedGstEquivalent,'70.40');
 assert.equal(p.input.taxMode,'Tax Included');
 assert.equal(price({...boq,survey:{...boq.survey,cashGstTreatment:'No GST added'}},'sample',input).total,'440.00');
 const legacy=price({...boq,survey:{family:'solar-hybrid'}},'sample',{...input,taxMode:'Tax Included'});
 assert.equal(legacy.total,'510.40'); assert.equal(legacy.tax,'70.40');assert.equal(legacy.profit,'40.00');
});
test('cash discounts stay out of solar and reduce retained selling without manufactured tax',()=>{
 const lines=[{description:'Panels',qty:'1',unit:'LS',group:'solar',beforeTax:'121',taxRate:'0'},{description:'Installation',qty:'1',unit:'LS',group:'balance',beforeTax:'389.40',taxRate:'0'}];
 const a=allocateDiscount(lines,'510.40','0','0','10','500.40',true);
 assert.equal(a.tax,'0.00');assert.equal(a.lines[0].allocatedDiscount,'0.00');assert.equal(a.lines[1].beforeTax,'379.40');
 const review=managementReview(lines,'510.40','0','0','400','0',{discount:'10'},true);
 assert.equal(review.proposed.profit,'100.40');assert.equal(review.proposed.profitPercent,'25.10');
});
