import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareWarehouseSource,warehouseLedgerKey} from '../server/inventory/warehouse-source.js';
import {reviewQuantities,closingEffect} from '../server/inventory/review-quantities.js';

const input=()=>({meta:{scope:'Local historical source'},balances:[{itemId:'FINAL',warehouse:'Lahore warehouse',unit:'m',description:'Cable variant retained',opening:'10.1',in:'3.2',out:'8.1',closing:'5.2',openingStatus:'Provisional',review:'Opening reconciliation pending'}],events:[{eventId:'in-1',itemId:'FINAL',warehouse:'Lahore warehouse',unit:'m',description:'Actual variant',in:'3.2',out:'0'},{eventId:'out-1',itemId:'FINAL',warehouse:'Lahore warehouse',unit:'m',description:'Actual variant',in:'0',out:'8.1'}]});
test('historical warehouse source validates exact decimal math without replaying movements or changing uncertain openings',()=>{
 const value=input(),before=structuredClone(value),result=prepareWarehouseSource(value,['FINAL']);assert.deepEqual(value,before);
 assert.equal(result.balances[0].closing,'5.2');assert.equal(result.balances[0].openingStatus,'Provisional');assert.equal(result.events[0].description,'Actual variant');assert.equal(result.postingEnabled,false);
 assert.notEqual(warehouseLedgerKey('FINAL','Lahore warehouse','m'),warehouseLedgerKey('FINAL','Karachi warehouse','m'));assert.notEqual(warehouseLedgerKey('FINAL','Lahore warehouse','m'),warehouseLedgerKey('FINAL','Lahore warehouse','ft'));
 const unknown=input() as any;unknown.balances[0].opening=null;unknown.balances[0].closing=null;assert.equal(prepareWarehouseSource(unknown,['FINAL']).summary.unknownClosings,1);
 const wrong=input();wrong.balances[0].closing='6';assert.throws(()=>prepareWarehouseSource(wrong,['FINAL']),/closing stock/);
 const mismatch=input();mismatch.events[0].in='4';assert.throws(()=>prepareWarehouseSource(mismatch,['FINAL']),/event totals/);
 const duplicate=input();duplicate.events.push(duplicate.events[0]);assert.throws(()=>prepareWarehouseSource(duplicate,['FINAL']),/Duplicate historical stock event/);
 assert.throws(()=>prepareWarehouseSource(input(),[]),/outside the final/);
 const missing=input();missing.balances=[];assert.throws(()=>prepareWarehouseSource(missing,['FINAL']),/no matching stock balance/);
 const residue=input();residue.balances[0].in='3.199999999999997';residue.balances[0].closing='5.199999999999997';const exported=prepareWarehouseSource(residue,['FINAL']);assert.equal(exported.balances[0].closing,'5.199999999999997');assert.equal(exported.balances[0].calculatedClosing,'5.2');assert.equal(exported.summary.precisionResidueRows,1);
});
test('incomplete units, scope or receipts cannot produce a false quantified final shortage',()=>{
 const base={quantities:{dispatch:'100',used:'60',expectedReturn:'40',countedReturn:'10',warehouseReturn:'10',credited:'10',returnDifference:'30',creditDifference:'0'},sourceRow:{}};
 for(const flag of ['unitHold','scopeHold','dispatchPartial','usagePartial']){const result=reviewQuantities({...base,sourceRow:{[flag]:true}});assert.equal(result.quantities.expectedReturn,null);assert.equal(result.quantities.returnDifference,null);assert.equal(result.quantities.countedReturn,'10');assert.equal(result.calculationHolds.length,1);}
 const partial=reviewQuantities({...base,sourceRow:{returnPartial:true}});assert.equal(partial.quantities.expectedReturn,'40');assert.equal(partial.quantities.returnDifference,null);assert.equal(partial.quantities.creditDifference,null);
 assert.equal(base.quantities.returnDifference,'30');
 assert.deepEqual(closingEffect({closing:'5.2',inDelta:'0.1',outDelta:'0.2'}),{before:'5.2',change:'-0.1',after:'5.1'});
 assert.deepEqual(closingEffect({closing:null,inDelta:'3',outDelta:'0'}),{before:null,change:'3',after:null});
});
