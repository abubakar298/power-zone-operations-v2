import {test} from 'node:test';
import assert from 'node:assert/strict';
import {materialIssueCategory} from '../shared/material-issue-category.js';
import {materialDocumentPolicy} from '../shared/material-documents.js';
import {fixedPreparationRows,variablePreparationRows,withMatchingVariableSection} from '../shared/material-preparation.js';
test('Al Noor BOQ cables and rooftop switchgear retain their proper categories',()=>{
 for(const description of ['2.5mm² earth panel to panel','6mm² DC earth','10mm² AC earth','16mm² 4C inverter cable','16mm² 4C load cable'])assert.equal(materialIssueCategory({itemId:'',description}),'AC & Earthing Cables',description);
 for(const description of ['Roof DC breaker','DC Circuit Breaker (Roof DB)','Inverter room DC breaker'])assert.equal(materialIssueCategory({itemId:'CH-BRK-DC-20A/4P',description,fixedGroup:'bess'}),'DC Switchgear');
 assert.equal(materialIssueCategory({itemId:'',description:'DC Circuit Breaker (Roof DB)'}),'DC Switchgear');
 assert.equal(materialIssueCategory({itemId:'',description:'AC & DC Boxes combined'}),'All Boxes');
 assert.equal(materialIssueCategory({itemId:'',description:'DC cable red 6mm²'}),'DC Cables & Communication Cables');
 assert.equal(materialIssueCategory({itemId:'CH-PCS-HYB-3P-020',description:'Inverter with cables and box'}),'BESS');
 assert.equal(materialDocumentPolicy({itemId:'CH-Mix Items All',description:'Mixed accessories'}).variableDispatch,true);
});
test('earthing cable allowances seed as variable; delivery costing does not seed warehouse stock',()=>{
 const source={siteId:'site',installation:true,customer:'UBL',items:[{key:'Earth Panel',description:'2.5mm² earth panel to panel',qty:'15',unit:'MTRS'},{key:'DC Earth',description:'6mm² DC earth',qty:'60',unit:'MTRS'},{key:'Delivery',description:'Delivery/logistics',qty:'25000',unit:'W costing basis'}]};
 assert.equal(fixedPreparationRows(source,[],()=> 'key').length,0);
 const rows=variablePreparationRows([source],[],()=> 'key');assert.equal(rows.length,2);assert.ok(rows.every(r=>r.out===''&&r.section==='customer'));
});

test('variable module metadata follows stock policy without changing details or quantities',()=>{
 for(const [itemId,description,section] of [['CH-Pvc Pipe 1.5 Inch','PVC Pipe 1.5 Inch','customer'],['CH-Mix Items All','Mixed accessories','internal'],['CH-CBL-ERT-10MM/1C-PK','10mm AC earth','customer']]){
 const row={key:'key',itemId,description,unit:'m',out:'5',sites:['site'],section:'internal' as const},fixed=withMatchingVariableSection(row);
 assert.equal(fixed.section,section);assert.equal(materialDocumentPolicy(fixed).group==='internal-variable'?'internal':'customer',fixed.section);assert.equal(fixed.out,row.out);assert.equal(fixed.itemId,row.itemId);assert.equal(fixed.description,row.description);assert.equal(row.section,'internal');
 }
});

test('explicitly bundled UBL smart meter does not become another warehouse issue',()=>{
 const source={siteId:'site',installation:true,customer:'United Bank Limited',items:[{key:'meter',description:'Smart meter included with inverter',qty:'1',unit:'No.'}]};
 assert.deepEqual(fixedPreparationRows(source,[],()=> 'key'),[]);
});
