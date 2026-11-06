import {test} from 'node:test';
import assert from 'node:assert/strict';
import {materialDocumentPolicy} from '../shared/material-documents.js';

test('customer sign-off contains measured cable, pipe and duct usage while internal consumables stay on the installation report',()=>{
 for(const [itemId,description] of [
  ['CH-CBL-AC-25MM/4C-PK','25mm AC cable'],['CH-CBL-ERT-10MM/1C-PK','10mm earthing cable'],
  ['CH-CBL-COM','CAT6 / genset meter communication cable variant'],['CH-Flex Pipe 1','1.5-inch flexible pipe'],
  ['CH-Pvc Pipe 1.5 Inch','1.5-inch PVC pipe'],['CH-Duct Slot 60x60','60x60 duct'],
 ]){
  const p=materialDocumentPolicy({itemId,description});assert.equal(p.variableDispatch,true);assert.equal(p.customerUsageSignoff,true);assert.equal(p.installationReconciliation,false);
 }
 for(const [itemId,description] of [
  ['CH-CABLE-TIES','12-inch cable ties'],['CH-PVC-TAPE','PVC insulation tape'],['CH-Mix Items All','16mm lugs'],
  ['CH-Mix Items All','Black screws'],['CH-Mix Items All','25mm thimbles'],['CH-MC4','MC4 connectors'],
  ['CH-PVC-BENDS-SOCKETS','1.5-inch pipe sockets'],['CH-GLAND-PG45','Cable gland PG45'],
 ]){
  const p=materialDocumentPolicy({itemId,description});assert.equal(p.variableDispatch,true);assert.equal(p.customerUsageSignoff,false);assert.equal(p.installationReconciliation,true);
 }
});
test('switchgear and major equipment remain fixed even when descriptions mention cables; approved earthing is locked and genset synch is excluded',()=>{
 for(const [itemId,description] of [['CH-BRK-DC-20A/4P','DC breaker with cable terminals'],['CH-PCS-HYB-3P-020','20kW inverter including cable fittings'],['CH-BAT-HV-05 KW','HV battery'],['CH-8 Way Box','8-way box'],['CH-Structure','Structure with mounting screws'],['CH-Solar Plate C620','Canadian solar panels']]){
  const p=materialDocumentPolicy({itemId,description});assert.equal(p.group,'fixed');assert.equal(p.installationReconciliation,true);assert.equal(p.variableDispatch,false);
 }
 const earth=materialDocumentPolicy({itemId:'CH-Earthing',description:'Earthing as per approved BOQ'});assert.equal(earth.group,'fixed');assert.equal(earth.approvedQuantityLocked,true);
 const sync=materialDocumentPolicy({itemId:'CH-GENSET-SYNC',description:'Genset synchronisation'});assert.equal(sync.group,'non-stock');assert.equal(sync.customerUsageSignoff,false);assert.equal(sync.installationReconciliation,false);
 assert.equal(materialDocumentPolicy({itemId:'',description:'Unknown custom assembly'}).classificationRequired,true);
});
