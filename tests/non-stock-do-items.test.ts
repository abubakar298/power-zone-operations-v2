import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isSolarStructureItem,solarStructureDescription,solarStructureKw,solarStructureKwChoices,solarStructureCatalogueItem} from '../shared/non-stock-do-items.js';
import {materialIssueCategory} from '../shared/material-issue-category.js';
import {materialDocumentPolicy} from '../shared/material-documents.js';
import {reviewIssueRows} from '../web/inventory-approved/site-issue-review.js';

test('solar structure kW wording is saved in its description and read back exactly',()=>{
 assert.equal(solarStructureDescription(3),'Solar structure — 3 kW');
 assert.equal(solarStructureKw('Solar structure — 3 kW'),3);
 assert.equal(solarStructureKw(' Solar structure — 100 kW '),100);
 for(const missing of ['Solar structure','Solar structure — 0 kW','Solar structure — 101 kW','Solar structure — 2.5 kW','Solar structure - 3 kW','',undefined,null])
  assert.equal(solarStructureKw(missing),null,String(missing));
 assert.deepEqual([solarStructureKwChoices[0],solarStructureKwChoices.at(-1),solarStructureKwChoices.length],[1,100,100]);
});

test('only CH-Solar Structure is the non-stock DO item; CH-Structure keeps its own rules',()=>{
 assert.equal(isSolarStructureItem('CH-Solar Structure'),true);
 assert.equal(isSolarStructureItem(' ch-solar structure '),true);
 for(const other of ['CH-Structure','CH-Earthing','CH-BAT-HV-05 KW','',undefined])assert.equal(isSolarStructureItem(other),false,String(other));
 assert.deepEqual(solarStructureCatalogueItem,{itemId:'CH-Solar Structure',description:'Solar structure',units:['No.']});
});

test('solar structure is a fixed DO item listed with panels, structure and earthing',()=>{
 const line={itemId:'CH-Solar Structure',description:'Solar structure — 3 kW'};
 assert.equal(materialIssueCategory(line),'Panels, Structure and Earthing');
 assert.equal(materialDocumentPolicy(line).group,'fixed');
 assert.equal(materialDocumentPolicy(line).variableDispatch,false);
 const row={key:'k',itemId:'CH-Solar Structure',description:'Solar structure — 3 kW',unit:'No.',out:'1',sites:['s'],fixedGroup:'panels' as const};
 assert.deepEqual(reviewIssueRows([row],{}).included.map(r=>[r.itemId,r.out,r.description]),[['CH-Solar Structure','1','Solar structure — 3 kW']],'The DO preview lists it with its kW.');
 assert.deepEqual(reviewIssueRows([row],{k:'1'}).included,[],'A structure already on an earlier DO is not sent again.');
});
