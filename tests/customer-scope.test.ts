import {test} from 'node:test';
import assert from 'node:assert/strict';
import {customerScopeItems,orderCustomerScopeLines} from '../server/commercial/customer-scope.js';
import type {BoqSnapshot} from '../server/boq/engine.js';

const fixture=(sp=false,dual=false)=>({survey:{family:'solar-hybrid',sourceMode:'Survey',acTerminationMode:'Measured',acInverter16:'10',acInverter25:'0',spInverterTerminationMetres:'20'},inverterConfig:{quantity:dual?2:1},lines:[]} as unknown as BoqSnapshot);
const line=(key:string,qty='1',description=key,specification:string|null=null)=>({key,qty,description,specification,brand:'Approved brand',unit:/Cable/.test(key)?'m':'Each'} as BoqSnapshot['lines'][number]);
test('customer protection overview uses actual included equipment and preserves frozen costing detail',()=>{
 const b=fixture(true),sources=[line('63A 2P MCB'),line('32A 2P MCB'),line('32A 2P Breaker Changeover'),line('63A 1P AC VPD'),line('SP AC Conduit Accessories and Box'),line('500V 2P DC Breaker','2'),line('DC SPD','1'),line('DC Fuse with Holder','2'),line('SP DC Enclosures'),line('AC SPD','0')];
 const original=JSON.stringify(sources),rows=customerScopeItems(b,sources);
 assert.deepEqual(rows.map(l=>l.description),['AC Protection Box (breakers, changeover, VPD, enclosures and accessories)','DC Protection Box (breakers, SPD, fuses and holders, enclosures and accessories)']);
 assert.deepEqual(rows.map(l=>[l.qty,l.unit]),[['1','Set'],['1','Set']]);assert.equal(JSON.stringify(sources),original);
});
test('AC termination rows partition stored conductor totals without changing quantities',()=>{
 const b=fixture(true),rows=customerScopeItems(b,[line('10mm² 1C AC Cable','60','10mm² single-core AC cable\nInverter termination (20 m): saved scope')]);
 assert.deepEqual(rows.map(l=>l.qty),['20','40']);assert.match(rows[0].description,/Inverter Termination/);assert.match(rows[1].description,/Load Panel Termination/);
 const dual=fixture(false,true);dual.survey.sourceMode='General quotation';
 const hv=customerScopeItems(dual,[line('16mm² 4C AC Cable','15'),line('25mm² 4C AC Cable','20')]);
 assert.deepEqual(hv.map(l=>[l.qty,l.description.split(' — ')[0]]),[['15','AC Cable Inverter Termination'],['20','AC Cable Load Panel Termination']]);
});
test('earthing labels distinguish use and vague General specification falls back to the actual item',()=>{
 const rows=customerScopeItems(fixture(),[line('2.5mm² Earthing Cable','5'),line('6mm² Earthing Cable','10'),line('10mm² Earthing Cable','15'),line('Earthing Bore'),line('Misc. Accessories','1','General','General')]);
 assert.match(rows[0].description,/Panel to Panel/);assert.match(rows[1].description,/DC Side/);assert.match(rows[2].description,/AC Side/);assert.match(rows[3].description,/Target earth resistance: 1–5 ohms, subject to site conditions/);assert.match(rows[4].description,/Miscellaneous Accessories/);
 const b=fixture(true);b.survey.family='bess-only';assert.match(customerScopeItems(b,[line('6mm² Earthing Cable','10')])[0].description,/AC Side/);
});

test('new scope order keeps financial amounts and Basic Breakup merged bands intact',()=>{
 const lines=[{description:'DC protection',group:'balance',unit:'Set',qty:'1',amount:'120.00',span:3,items:[{description:'DC Protection Box (SPD)',unit:'Set',qty:'1'}]},{description:'AC protection',group:'balance',unit:'Set',qty:'1',items:[{description:'AC Protection Box (breakers)',unit:'Set',qty:'1'}]},{description:'Cable',group:'balance',unit:'m',qty:'10',items:[{description:'AC Cable Inverter Termination',unit:'m',qty:'10'}]}] as import('../server/commercial/engine.js').QuoteLine[];
 const before=JSON.stringify(lines),basic=orderCustomerScopeLines(lines,'Basic Breakup');
 assert.match(basic[0].items![0].description,/AC Cable/);assert.equal(basic[0].amount,'120.00');assert.equal(basic[0].span,3);assert.equal(basic.filter(l=>l.amount!==undefined).length,1);assert.equal(JSON.stringify(lines),before);
});
