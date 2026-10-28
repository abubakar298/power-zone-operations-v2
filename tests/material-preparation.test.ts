import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixedPreparationRows} from '../shared/material-preparation.js';
const catalogue=[{itemId:'CH-PCS-20',description:'20kW inverter',units:['Each']},{itemId:'CH-CBL-ERT-10MM/1C-PK',description:'Earthing cable',units:['m']},{itemId:'CH-SM-3P',description:'Smart meter',units:['Each']}];
test('approved fixed preparation keeps counts, unresolved identities and locked earthing without including consumables or services',()=>{
 let n=0;const source={siteId:'site',installation:true,customer:'United Bank Limited',items:[{key:'CH-PCS-20',description:'20kW inverter',qty:'1',unit:'Each'},{key:'CH-CBL-ERT-10MM/1C-PK',description:'10mm earthing cable',qty:'90',unit:'m'},{key:'CH-SM-3P',description:'Smart meter',qty:'1',unit:'Each'},{key:'CH-Earthing',description:'Earthing bore',qty:'2',unit:'JOB'},{key:'UNKNOWN-BOX',description:'Approved AC box',qty:'1',unit:'Each'},{key:'SERVICE',description:'Electrical installation',qty:'1',unit:'JOB'},{key:'GENSET-SYNC',description:'Genset synchronisation',qty:'1',unit:'Each'}]};
 const rows=fixedPreparationRows(source,catalogue,()=>String(++n));assert.equal(rows.length,3);
 assert.equal(rows[0].out,'1');assert.equal(rows[0].fixedGroup,'bess');assert.equal(rows[1].itemId,'CH-Earthing');assert.equal(rows[1].out,'2');assert.equal(rows[1].fixedGroup,'panels');assert.equal(rows[2].description,'Approved AC box');assert.equal(rows[2].itemId,'');assert.deepEqual(rows.map(r=>r.key),['1','2','3']);
});
test('delivery-only cable products remain fixed and power ratings cannot become equipment counts',()=>{
 const rows=fixedPreparationRows({siteId:'s',installation:false,customer:'Other',items:[{key:'CH-CBL-ERT-10MM/1C-PK',description:'Earthing cable',qty:'10',unit:'m'},{key:'CH-PCS-20',description:'20kW inverter',qty:'20',unit:'kW'},{key:'CH-SM-3P',description:'Smart meter',qty:'1',unit:'Each'}]},catalogue,()=>crypto.randomUUID());
 assert.equal(rows.length,3);assert.equal(rows[0].out,'10');assert.equal(rows[1].out,'');assert.equal(rows[1].unit,'');assert.equal(rows[2].itemId,'CH-SM-3P');
});
test('solar wattage is not a physical panel count and approved earthing-bore references stay locked under their final ID',()=>{
 const rows=fixedPreparationRows({siteId:'s',installation:true,customer:'Other',items:[{key:'SOLAR-PANELS',description:'Solar panels',qty:'31605',unit:'Watts'},{key:'BORE-SERVICE',description:'Complete Earthing Bore',qty:'2',unit:'JOB'}]},catalogue,()=>crypto.randomUUID());
 assert.equal(rows[0].out,'');assert.equal(rows[0].basisLine,0);assert.equal(rows[1].itemId,'CH-Earthing');assert.equal(rows[1].out,'2');assert.equal(rows[1].unit,'JOB');assert.equal(rows[1].basisLine,1);
});
test('delivery allowances are not warehouse rows, PV module counts stay under panels and equivalent count labels need no conversion',()=>{
 const rows=fixedPreparationRows({siteId:'s',installation:true,customer:'Other',items:[{key:'Delivery',description:'Delivery',qty:'31605',unit:'W'},{key:'PV',description:'Solar PV Modules',qty:'49',unit:'No.'},{key:'CH-PCS-20',description:'20kW inverter',qty:'1',unit:'No.'}]},catalogue,()=>crypto.randomUUID());
 assert.equal(rows.length,2);assert.equal(rows[0].fixedGroup,'panels');assert.equal(rows[0].out,'49');assert.equal(rows[1].unit,'Each');assert.equal(rows[1].out,'1');
});

test('only explicit aliases into the final stock catalogue seed approved BOQ identities',()=>{
 const catalogue=[{itemId:'CH-PCS-HYB-1P-006',description:'6kW single-phase inverter',units:['piece']},{itemId:'CH-BAT-LV-05 KW',description:'5kWh LV battery without BMS',units:['piece']}];
 const source={siteId:'site',installation:true,customer:'UBL',items:[{key:'HYB-SP-006',qty:1,unit:'Each'},{key:'BAT-LV-05 KW WO BMS',qty:2,unit:'Each'},{key:'63A 1P AC VPD',qty:1,unit:'Each'}]};let n=0;
 const rows=fixedPreparationRows(source,catalogue,()=>String(++n),{'HYB-SP-006':'CH-PCS-HYB-1P-006','BAT-LV-05 KW WO BMS':'CH-BAT-LV-05 KW','63A 1P AC VPD':'CH-VPD-2P'});
 assert.equal(rows[0].itemId,'CH-PCS-HYB-1P-006');assert.equal(rows[0].out,'1');assert.equal(rows[0].unit,'piece');assert.equal(rows[1].itemId,'CH-BAT-LV-05 KW');assert.equal(rows[1].out,'2');assert.equal(rows[2].itemId,'','A commercial/non-final identity is not silently converted to stock.');
 assert.equal(fixedPreparationRows(source,catalogue,()=>String(++n))[0].itemId,'','No prefix guessing when the explicit alias is absent.');
});
