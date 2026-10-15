import {test} from 'node:test';import assert from 'node:assert/strict';import {ublConfigurationReview} from '../server/project-workflow/ubl-survey-comparison.js';
test('UBL configuration flag excludes whole-panel rounding and flags material PV/inverter/battery changes',()=>{
 const approved={pvWatts:'20000',solutionId:'20-20-30'};const survey={panelWattage:'620',panelQty:32,inverter:'20 kW',batteryKwh:30};
 assert.equal(ublConfigurationReview(survey,approved).needsReview,false);
 assert.equal(ublConfigurationReview(survey,approved).panelRoundingOnly,true);
 assert.equal(ublConfigurationReview({...survey,panelQty:24},approved).needsReview,true);
 assert.equal(ublConfigurationReview({...survey,inverter:'15 kW'},approved).needsReview,true);
 assert.equal(ublConfigurationReview({...survey,batteryKwh:40},approved).needsReview,true);
 assert.equal(ublConfigurationReview({panelWattage:'620',panelQty:56,inverter:'2×15 kW',batteryKwh:40},{pvWatts:'35000',solutionId:'35-30-40'}).needsReview,false);
});
