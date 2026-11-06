import {test} from 'node:test';
import assert from 'node:assert/strict';
import {phaseBudgets} from '../server/director/repository.js';
import type {BoqSnapshot} from '../server/boq/engine.js';
test('frozen pre-agreed BOQ without an engine inverterConfig retains separate Inverter, Batteries, BMS and EPC budgets',()=>{
 const snapshot={lines:[
  {key:'Solar PV Modules',phase:'Solar Panels',total:'1365000.00'},
  {key:'Structure',phase:'Structure',total:'700000.00'},
  {key:'HYB-15K',phase:'BESS',total:'720000.00'},
  {key:'BAT-HV-5K',phase:'BESS',total:'1680000.00'},
  {key:'CH-BMS-HV',phase:'BESS',total:'320000.00'},
  {key:'Earthing Bore',phase:'EPC',total:'50000.00'},
  {key:'DC Cable',phase:'EPC',total:'114800.00'},
 ]} as unknown as BoqSnapshot;
 const budgets=Object.fromEntries(phaseBudgets(snapshot).map(p=>[p.name,p.budgetedCost]));
 assert.deepEqual(budgets,{'Solar Panels':'1365000.00',Structure:'700000.00',Inverter:'720000.00',Batteries:'1680000.00',BMS:'320000.00',EPC:'164800.00'});
 assert.equal(snapshot.inverterConfig,undefined,'The frozen source is not rewritten to invent an engine configuration');
});
