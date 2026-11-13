import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BoqSnapshot } from '../server/boq/engine.js';
import { correctedClosureCategories, issuedUblSolarBasis } from '../server/accounts/closure-budget-categories.js';
import { closureEpcSelling } from '../server/accounts/phase-comparison.js';
import { phaseBudgets } from '../server/director/repository.js';
import { solarEpcLineCategory } from '../server/ubl/solar-epc.js';

test('reclassifies a submitted UBL Solar breakdown using the issued BOQ without changing the totals or actuals', () => {
  const lines = [
    { key: 'Electrical labour', phase: 'EPC', epc: 'Installation Cost', total: '105000' },
    { key: 'Delivery/logistics', phase: 'EPC', epc: 'Installation Cost', total: '105000' },
    { key: 'Earthing Bore', phase: 'EPC', epc: 'Earthing Cost', total: '50000' },
    { key: 'Other items', phase: 'EPC', epc: 'Installation Cost', total: '614800' },
  ];
  const saved = {
    budget: { EPC: '874800' },
    phaseSelling: { EPC: '1018459.68' },
    epcBudget: { 'Electrical Labour': '0', 'Earthing Cost': '50000', Deliveries: '0', 'Installation Cost': '824800' },
    input: { epc: { 'Electrical Labour': '21240', Deliveries: '34000' } },
  };
  const oldIssuedOrder = {
    customer: { shortCode: 'UBL' }, frameworkKey: '35-30-40:Revised',
    approvedCommercialSource: { type: 'framework' },
  };
  const basis = {
    isUblSolar: issuedUblSolarBasis(null, oldIssuedOrder, 'solar-hybrid'), isBankUps: false, lines,
  };
  assert.equal(issuedUblSolarBasis(null, oldIssuedOrder, 'bess-only'), false);
  assert.equal(issuedUblSolarBasis(null, { ...oldIssuedOrder, approvedCommercialSource: { type: 'quotation' } }, 'solar-hybrid'), false);
  const before = structuredClone(saved);
  const repaired = correctedClosureCategories(saved, basis);
  assert.deepEqual(repaired.epcBudget, {
    'Electrical Labour': '105000.00', 'Earthing Cost': '50000.00', Deliveries: '105000.00', 'Installation Cost': '614800.00',
  });
  assert.deepEqual(closureEpcSelling(repaired.phaseSelling.EPC, repaired.epcBudget, repaired.budget.EPC), {
    'Electrical Labour': '122243.10', 'Earthing Cost': '58211.00', Deliveries: '122243.11', 'Installation Cost': '715762.47',
  });
  assert.equal(repaired.input, saved.input);
  assert.equal(repaired.budget, saved.budget);
  assert.deepEqual(saved, before);
  assert.equal(correctedClosureCategories(repaired, basis), repaired);
  assert.equal(correctedClosureCategories(saved, { ...basis, isUblSolar: false }), saved);
  assert.equal(solarEpcLineCategory({ key: 'Labour', description: 'Electrical labour' }), 'Electrical Labour');
  assert.equal(solarEpcLineCategory({ key: 'Delivery', description: 'Delivery/logistics' }), 'Deliveries');
});

test('puts LV and HV BMS in their own budget phase and repairs saved UPS splits without changing actuals', () => {
  for (const key of ['CH-BMS-LV', 'CH-BMS-HV', 'BMS-LV']) {
    const lines = [
      { key: 'HYB-SP-006', phase: 'BESS', total: '310000' },
      { key: 'BAT-LV-05 KW WO BMS', phase: 'BESS', total: '280000' },
      { key, phase: 'BESS', total: '80000' },
    ];
    const budget = Object.fromEntries(phaseBudgets({ lines } as unknown as BoqSnapshot).map(p => [p.name, p.budgetedCost]));
    assert.equal(budget.BMS, '80000.00');
    assert.equal(budget.Batteries, '280000.00');
    const saved = {
      budget: { ...budget, Batteries: '360000', BMS: '0' },
      phaseSelling: { Installations: '45000' },
      input: { actual: { Batteries: '275000', BMS: '78000' } },
    };
    const repaired = correctedClosureCategories(saved, { isUblSolar: false, isBankUps: true, lines });
    assert.deepEqual(repaired.budget, budget);
    assert.deepEqual(repaired.phaseSelling, { EPC: '45000' });
    assert.equal(repaired.input, saved.input);
    assert.equal(saved.budget.BMS, '0');
  }
});
