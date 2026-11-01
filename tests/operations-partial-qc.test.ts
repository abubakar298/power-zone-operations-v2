import {test} from 'node:test';
import assert from 'node:assert/strict';
import {completeQcStage,completeUpsJob} from '../server/operations-board/workflow.js';
test('partial delivery permits sequential QC but cannot complete delivery or final handover',()=>{
 const now='2026-10-28T10:00:00Z';
 const site:any={id:'partial-fixture',name:'Fixture',ipo:'fixture',installation:true,projectType:'solar-bess',stage:'awaiting',completed:false,deliveryDate:'2026-10-27',deliveries:[{partial:true}],accounts:[],history:[],documents:[]};
 const entry:any={date:'2026-10-28',evidence:{id:'fixture',mediaType:'image/jpeg'}};
 assert.throws(()=>completeQcStage({...site,deliveries:[]},'civil',entry,now),/recorded delivery/);
 assert.throws(()=>completeQcStage(site,'electrical',entry,now),/earlier QC/);
 let result=completeQcStage(site,'civil',entry,now);
 result=completeQcStage(result,'electrical',entry,now);
 result=completeQcStage(result,'testing',entry,now);
 assert.equal(result.stage,'awaiting');assert.equal(result.completed,false);assert.deepEqual(result.accounts,[]);
 assert.throws(()=>completeQcStage(result,'signoff',entry,now),/remaining delivery/);
 assert.throws(()=>completeUpsJob({...site,projectType:'ups'}, {...entry,checks:{}},now),/after delivery/);
});

test('QC accepts an explicit no-variable completion without IRR or manual material quantities',()=>{
 const now='2026-11-01T10:00:00Z';
 const site:any={id:'qc-cleanup',installation:true,projectType:'ups',stage:'delivered',completed:false,deliveryDate:'2026-10-30',deliveries:[{signedDo:{id:'do'},partial:false}],accounts:[],history:[],documents:[]};
 const entry:any={stagePictures:Object.fromEntries(['mounting','electrical','testingTraining'].map(key=>[key,[{id:key,mediaType:'image/jpeg'}]])),date:'2026-10-31',evidence:{id:'photo',mediaType:'image/jpeg'},acknowledgement:{id:'ack'},checks:{mounting:true,electrical:true,testingTraining:true,signoff:true}};
 assert.throws(()=>completeUpsJob(site,{...entry,stagePictures:undefined},now),/pictures for system mounting/);
 assert.throws(()=>completeUpsJob(site,entry,now),/variable-items sign-off/);
 assert.throws(()=>completeUpsJob(site,{...entry,variableSignoff:{id:'do'}},now),/signed delivery DO/);
 assert.throws(()=>completeUpsJob(site,{...entry,noVariableItemsUsed:true,variableSignoff:{id:'vso'}},now),/not both/);
 const noUse=completeUpsJob(site,{...entry,noVariableItemsUsed:true},now);
 assert.equal(noUse.completed,true);assert.equal(noUse.qcJob?.noVariableItemsUsed,true);
 assert.equal(noUse.documents?.[0].completionEvidenceVersion,2);assert.deepEqual(noUse.documents?.[0].evidence.map(f=>f.id),['ack']);
 const used=completeUpsJob(site,{...entry,variableSignoff:{id:'vso'}},now);
 assert.equal(used.completed,true);assert.deepEqual(used.documents?.[0].evidence.map(f=>f.id),['ack','vso']);
 assert.equal((used as any).stock,undefined);
});
