import {test} from 'node:test';
import assert from 'node:assert/strict';
import {approvedMaterialView} from '../server/project-workflow/advance-material-view.js';
test('approved UBL brands and specifications replace costing labels without changing quantities or stock IDs',()=>{
 const items=[{rateKey:'Solar PV Modules',description:'Solar panels',brand:'General',specification:'Solar panels',qty:'35000',unit:'W',itemId:null},{rateKey:'16mm² 4C AC Cable',description:'16mm² 4C load cable',brand:'Pakistan Cables',specification:'Stock wording',qty:'20',unit:'MTRS',itemId:'CH-CBL-AC-16MM/4C-PK'}];
 const before=JSON.stringify(items);
 const result=approvedMaterialView(items,[{id:'A1',specification:'N-Type Bifacial PV Modules',brands:'Longi/Jinko/Canadian'},{id:'E19',specification:'Inverter cable',brands:'Pakistan Cables'},{id:'E20',specification:'Load cable',brands:'Pakistan Cables'}]);
 assert.deepEqual(result[0].approvedBrands,['Longi','Jinko','Canadian']);assert.equal(result[0].specification,'N-Type Bifacial PV Modules');assert.equal(result[0].category,'Solar Panels');assert.equal(result[0].itemId,null);assert.equal(result[1].approvedBoqRowId,'E20');assert.equal(result[1].specification,'Load cable');assert.equal(result[1].itemId,items[1].itemId);assert.deepEqual(result.map(r=>r.qty),items.map(r=>r.qty));assert.equal(JSON.stringify(items),before);
});
test('quotation alternatives survive material projection and battery components retain stock specification',()=>{
 const items=[{rateKey:'BAT-HV-05 KW WO BMS',description:'HV 5kWh battery',specification:'5 kWh HV module',qty:'8',unit:'No.'},{rateKey:'6mm² DC Cable Red',description:'DC red cable',qty:'100',unit:'MTRS'}];
 const result=approvedMaterialView(items,[{id:'C4',specification:'40 kWh bank',brands:'Chint/BYD'}],[{key:'6mm² DC Cable Red',description:'DC red cable',brand:'Any of the Above',brandAlternatives:['Pakistan Cables','Fast Cables'],itemId:'CABLE-6'}]);
 assert.equal(result[0].specification,'5 kWh HV module');assert.deepEqual(result[0].approvedBrands,['Chint']);assert.deepEqual(result[1].approvedBrands,['Pakistan Cables','Fast Cables']);assert.equal(result[1].itemId,'CABLE-6');assert.equal(result[0].category,'Batteries & BMS');assert.equal(result[1].category,'Cables');
});

test('a stock rating conflict is surfaced without editing the approved scope or stock ID',()=>{const result=approvedMaterialView([{itemId:'CH-CHG-63A/4P',rateKey:'63A 4P Changeover',description:'63A 4P Changeover',specification:'63A 4 Pole Changeover',qty:'1',unit:'No.'}],[{id:'E18',specification:'100A rotary changeover with box',brands:'Chint/Schneider/ABB'}]);assert.match(result[0].specificationReview??'',/differs/);assert.equal(result[0].stockSpecification,'63A 4 Pole Changeover');assert.equal(result[0].specification,'100A rotary changeover with box');assert.equal(result[0].itemId,'CH-CHG-63A/4P');});

test('explicit Chint material selection remains Chint despite wider agreement alternatives',()=>{const result=approvedMaterialView([{rateKey:'HYB-3P-020',description:'20 kW inverter',brand:'Chint Power',specification:'20 kW',qty:'1',unit:'No.'},{rateKey:'DC Breaker',description:'Roof DC breaker',brand:'CHINT',qty:'1',unit:'No.'}],[{id:'C3',brands:'Chint/Huawei/Sungrow',specification:'Hybrid inverter'},{id:'D5',brands:'Chint/Schneider/ABB',specification:'20A 4P'}]);assert.deepEqual(result[0].approvedBrands,['Chint Power']);assert.deepEqual(result[1].approvedBrands,['CHINT']);});

test('UBL lists containing Chint narrow to Chint even when saved costing brand is General',()=>{const result=approvedMaterialView([{rateKey:'Extra Smart Meter',description:'Smart meter included with inverter',brand:'General',qty:'1',unit:'No.'}],[{id:'G27',brands:'Chint/Schneider/ABB/Huawei',specification:'Included smart meter'}]);assert.deepEqual(result[0].approvedBrands,['Chint']);});
