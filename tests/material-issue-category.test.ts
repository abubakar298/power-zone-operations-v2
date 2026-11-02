import {test} from 'node:test';
import assert from 'node:assert/strict';
import {materialIssueCategory} from '../shared/material-issue-category.js';
import {materialDocumentPolicy} from '../shared/material-documents.js';
import {fixedPreparationRows,variablePreparationRows} from '../shared/material-preparation.js';
test('Al Noor BOQ cables and rooftop switchgear retain their proper categories',()=>{
 for(const description of ['2.5mm² earth panel to panel','6mm² DC earth','10mm² AC earth','16mm² 4C inverter cable','16mm² 4C load cable'])assert.equal(materialIssueCategory({itemId:'',description}),'AC & Earthing Cables',description);
 for(const description of ['Roof DC breaker','DC Circuit Breaker (Roof DB)','Inverter room DC breaker'])assert.equal(materialIssueCategory({itemId:'CH-BRK-DC-20A/4P',description}),'DC Switchgear');
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
