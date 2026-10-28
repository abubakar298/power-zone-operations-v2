import {test} from 'node:test';
import assert from 'node:assert/strict';
import {completeQcStage,completeUpsJob} from '../server/operations-board/workflow.js';
test('partial delivery permits sequential QC but cannot complete delivery or final handover',()=>{
 const now='2026-10-28T10:00:00Z';
 const site:any={id:'partial-fixture',name:'Fixture',ipo:'fixture',installation:true,projectType:'solar-bess',stage:'awaiting',completed:false,deliveryDate:'2026-10-27',deliveries:[{partial:true}],accounts:[],history:[],documents:[]};
 const entry:any={date:'2026-10-28',evidence:{id:'fixture'}};
 assert.throws(()=>completeQcStage({...site,deliveries:[]},'civil',entry,now),/recorded delivery/);
 assert.throws(()=>completeQcStage(site,'electrical',entry,now),/earlier QC/);
 let result=completeQcStage(site,'civil',entry,now);
 result=completeQcStage(result,'electrical',entry,now);
 result=completeQcStage(result,'testing',entry,now);
 assert.equal(result.stage,'awaiting');assert.equal(result.completed,false);assert.deepEqual(result.accounts,[]);
 assert.throws(()=>completeQcStage(result,'signoff',entry,now),/remaining delivery/);
 assert.throws(()=>completeUpsJob({...site,projectType:'ups'}, {...entry,checks:{}},now),/after delivery/);
});
