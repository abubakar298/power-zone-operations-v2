import {BoqRepository} from '../server/boq/repository.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {ProjectWorkflowRepository} from '../server/project-workflow/repository.js';
test('own sent survey opens one independent quotation draft without completing or replacing Design work',async()=>{
 const db=await testDatabase();try{
  const actor=randomUUID(),other=randomUUID(),designer=randomUUID();
  for(const [id,role]of [[actor,'Coordinator'],[other,'Coordinator'],[designer,'Design']])await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'test-only',$4)",[id,id+'@example.test',role,role]);
  const repo=new ProjectWorkflowRepository(db.pool),created=await repo.create(actor,{requestKey:randomUUID(),customerId:5,siteName:'Disposable sent survey quotation',siteCode:'SENT-QUOTE-TEST',route:'survey-quote',notes:'Test only'});
  await db.pool.query("UPDATE project_workflow_records SET stage='survey_requested',planning_owner_id=$2,data=data||$3::jsonb WHERE id=$1",[created.id,designer,JSON.stringify({sentToDesignAt:'2026-10-31',surveyInputs:{privateDesignInput:'preserve'},sentEvidence:'existing'})]);
  const before=(await db.pool.query('SELECT * FROM project_workflow_records WHERE id=$1',[created.id])).rows[0];
  await assert.rejects(repo.prepareSentQuotation(other,created.id,{version:before.version}));
  await assert.rejects(repo.prepareSentQuotation(designer,created.id,{version:before.version}));
  await assert.rejects(repo.prepareSentQuotation(actor,created.id,{version:before.version+1}));
  const first=await repo.prepareSentQuotation(actor,created.id,{version:before.version});
  const repeated=await repo.prepareSentQuotation(actor,created.id,{version:before.version});
  assert.equal(repeated.recordId,first.recordId);assert.equal(repeated.draftId,first.draftId);assert.equal(repeated.repeated,true);
  const source=(await db.pool.query('SELECT * FROM project_workflow_records WHERE id=$1',[created.id])).rows[0];
  assert.equal(first.recordId,created.id);assert.equal(source.stage,before.stage);assert.equal(source.planning_owner_id,designer);assert.equal(source.data.sentEvidence,before.data.sentEvidence);assert.deepEqual(source.data.surveyInputs,before.data.surveyInputs);assert.equal(source.data.designHandoffAt,undefined);
  assert.equal(source.data.draftId,first.draftId);assert.equal(source.data.sentQuotationDraftId,first.draftId);assert.equal(source.data.coordinationPreparedBeforeDesign,true);
  const draft=(await db.pool.query('SELECT * FROM survey_drafts WHERE id=$1',[first.draftId])).rows[0];assert.equal(draft.owner_id,actor);assert.equal(draft.inputs.customerId,source.customer_id);assert.equal(draft.inputs.siteCode,'SENT-QUOTE-TEST');assert.equal(draft.inputs.sourceMode,'General quotation');assert.equal(draft.inputs.privateDesignInput,undefined);
  const boqs=new BoqRepository(db.pool);const listed=(await boqs.drafts(actor)).find(row=>row.id===first.draftId);assert.ok(listed);assert.equal(listed.review_id,null);assert.equal(listed.review_status,null,'An unsubmitted survey quotation opens as an editable draft, not an awaiting-review record.');assert.equal(listed.inputs.siteName,draft.inputs.siteName);assert.equal(listed.inputs.customerId,source.customer_id);const saved=await boqs.draft(actor,first.draftId,draft.version,{...draft.inputs,family:'solar-hybrid'});
  assert.equal(saved.id,first.draftId);await assert.rejects(boqs.draft(actor,first.draftId,saved.version,{...draft.inputs,family:'solar-hybrid',siteCode:'FOREIGN'}));
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM project_workflow_records WHERE site_id=$1',[source.site_id])).rows[0].n,1);
  const review=await repo.document(db.pool as any,source,designer,'Technical review',{boq:{survey:{...draft.inputs,family:'solar-hybrid',uploadIds:[]},lines:[],total:'0'},notes:'Disposable reviewed survey'});
  await db.pool.query("UPDATE project_workflow_records SET stage='technical_review',technical_owner_id=$2,data=data||$3::jsonb WHERE id=$1",[created.id,designer,JSON.stringify({reviewDocumentId:review.id})]);
  await repo.action(designer,created.id,{version:source.version,requestKey:randomUUID(),action:'handoff',input:{notes:'Design reviewed and returned this fictional survey'}});
  const handed=(await db.pool.query('SELECT * FROM project_workflow_records WHERE id=$1',[created.id])).rows[0];
  assert.equal(handed.stage,'design_handed_off');assert.equal(handed.data.draftId,first.draftId);assert.ok(handed.data.designDraftId);assert.notEqual(handed.data.designDraftId,first.draftId);assert.ok(handed.data.designLinkedBoqRevisionId);assert.ok(handed.data.designHandoffAt);
  await assert.rejects(repo.prepareSentQuotation(actor,created.id,{version:handed.version}));
 }finally{await db.close();}
});
