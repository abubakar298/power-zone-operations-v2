import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dcConductorMetres,panelEarthMetres,roundedSurveyCableMetres} from '../shared/survey-cables.js';
import {ublSurveyComparison} from '../server/project-workflow/ubl-survey-comparison.js';
test('DC red and black retain combined measured quantity; panel earth uses one foot per panel',()=>{
 assert.equal(dcConductorMetres('164.592'),'82.296');
 assert.equal(panelEarthMetres(32),'10');
 assert.equal(panelEarthMetres(0),'0');
});
test('UBL comparison shows separate measured red/black against their respective approved lines',async()=>{
 const pool={query:async(sql:string)=>({rows:sql.includes('short_code')?[{short_code:'UBL'}]:[]})};
 const basis={source:{},boq:{survey:{family:'solar-hybrid'},engineering:{pvWatts:'20000',solutionId:'20-20-30'},lines:[{description:'DC cable black 6mm²',qty:'135',key:'DC Black',phase:'EPC'},{description:'DC cable red 6mm²',qty:'135',key:'DC Red',phase:'EPC'}]}};
 const comparison=await ublSurveyComparison(pool as any,{customer_id:5,route:'survey-framework',data:{surveyInputs:{family:'solar-hybrid',panelQty:32,panelWattage:'620',inverter:'20 kW',batteryKwh:30,dcMetres:'164.592',earth25:'10'}}},basis);
 const rows=comparison!.rows.filter((r:any)=>/^6mm² DC cable/.test(r.field));
 assert.equal(rows.length,2);
 for(const row of rows){assert.equal(row.approved,'135');assert.equal(row.entered,'82.296');}
 assert.ok(!comparison!.rows.some((r:any)=>r.field.includes('combined red/black')));
 assert.equal(comparison!.standardsReview!.needsReview,false);
});

test('UBL measured cable metres round up per colour without rounding PV wattage',()=>{
 assert.equal(roundedSurveyCableMetres('dcMetres','164.592'),'166');
 assert.equal(dcConductorMetres(roundedSurveyCableMetres('dcMetres','164.592')),'83');
 assert.equal(roundedSurveyCableMetres('acPanel16','21.336'),'22');
 assert.equal(roundedSurveyCableMetres('earth6','27.432'),'28');
 assert.equal(roundedSurveyCableMetres('earth25','9.7536'),'10');
 assert.equal(roundedSurveyCableMetres('earth10','0'),'0');
});
