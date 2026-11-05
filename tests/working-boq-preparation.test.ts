import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';import {BoqRepository} from '../server/boq/repository.js';import {CommercialRepository} from '../server/commercial/repository.js';import {surveySchema} from '../server/boq/schema.js';import {pricingSchema,quotationSchema} from '../server/commercial/schema.js';
for(const role of ['Coordinator','Management','Admin'])test(`${role}: repeated BOQ/pricing edits retain one preparation and freeze at quotation creation`,async()=>{
 const db=await testDatabase();try{
 const actor=randomUUID(),other=randomUUID();for(const[id,r]of[[actor,role],[other,'Coordinator']])await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,'isolated')",[id,id+'@example.test',r]);
 const boqs=new BoqRepository(db.pool),commercial=new CommercialRepository(db.pool);
 const survey=surveySchema.parse({family:'direct-product',customerId:3,siteName:'Working '+role,siteCode:'WORK-'+role,location:'',panelQty:0,panelWattage:'0',structure:'L1',dcMetres:'0',earth25:'0',earth6:'0',earth10:'0',inverter:'Products',batteryKwh:0,brands:{},smartMeter:false,genset:false,preparedBy:role,directProducts:[{kind:'item',key:'HYB-3P-020',qty:'1'}]});
 let draft=await boqs.draft(actor,undefined,0,survey),preview=await boqs.preview(survey),working=await boqs.save(actor,draft.id,draft.version,preview.fingerprint,true);
 const identity={id:working.id,number:working.number},draftId=draft.id;
 const pi=(id:string)=>pricingSchema.parse({boqRevisionId:id,presentation:'No Breakup',taxMode:'Tax Included',discountPercent:'0',preparedBy:role});
 const oldPricePreview=await commercial.pricingPreview(actor,pi(working.id)),oldPricing=await commercial.pricingSave(actor,pi(working.id),oldPricePreview.fingerprint,randomUUID());
 for(const qty of ['2','3']){
  assert.equal((await boqs.preparation(actor,working.id,true,true)).draftId,draftId);
  assert.equal((await boqs.preparation(actor,working.id,true,true)).draftId,draftId);
  const row=(await boqs.drafts(actor)).find(d=>d.id===draftId)!;assert.ok(row);
  const changed=surveySchema.parse({...row.inputs,directProducts:[{...survey.directProducts![0],qty}]});
  draft=await boqs.draft(actor,row.id,row.version,changed,row.base_revision_id??undefined,row.revision_reason,row.revision_origin??undefined);preview=await boqs.preview(changed,row.base_revision_id??undefined);
  working=await boqs.save(actor,draft.id,draft.version,preview.fingerprint,true);
  assert.deepEqual({id:working.id,number:working.number},identity);assert.equal(working.snapshot.survey.directProducts[0].qty,qty);
 }
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM boq_revisions')).rows[0].n,1);
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM survey_drafts')).rows[0].n,1);
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM boq_working_changes')).rows[0].n,2);
 await assert.rejects(boqs.preparation(other,working.id,true,true),/not found/);
 if(role==='Coordinator'){
   const manager=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Management','Management','isolated')",[manager,manager+'@example.test']);
   assert.equal((await boqs.preparation(manager,working.id,true,true)).draftId,draftId);
   const shared=(await boqs.drafts(manager)).find(d=>d.id===draftId)!;assert.ok(shared);const edited=await boqs.draft(manager,shared.id,shared.version,shared.inputs,shared.base_revision_id??undefined,shared.revision_reason,shared.revision_origin??undefined),preview=await boqs.preview(shared.inputs,shared.base_revision_id??undefined);
   assert.equal((await boqs.save(manager,edited.id,edited.version,preview.fingerprint,true)).id,working.id);
   await assert.rejects(boqs.draft(actor,shared.id,shared.version,shared.inputs),/changed/);
 }
 const qi=(pricingId:string)=>quotationSchema.parse({pricingId,quotedDate:'2026-11-05',validity:'7 Days',proposedBy:role});
 const stale=await commercial.quotationPreview(actor,qi(oldPricing.id));await assert.rejects(commercial.quotationSave(actor,qi(oldPricing.id),stale.fingerprint,randomUUID()),/BOQ changed/);
 const pp=await commercial.pricingPreview(actor,pi(working.id)),price=await commercial.pricingSave(actor,pi(working.id),pp.fingerprint,randomUUID()),qp=await commercial.quotationPreview(actor,qi(price.id)),key=randomUUID(),quote=await commercial.quotationSave(actor,qi(price.id),qp.fingerprint,key);
 assert.equal((await commercial.quotationSave(actor,qi(price.id),qp.fingerprint,key)).id,quote.id);
 await assert.rejects(boqs.preparation(actor,working.id,true,true),/quotation has been created/);
 const row=(await db.pool.query('SELECT * FROM survey_drafts WHERE id=$1',[draftId])).rows[0];await assert.rejects(boqs.draft(actor,row.id,row.version,survey),/quotation has been created/);
 await assert.rejects(db.pool.query("UPDATE boq_revisions SET snapshot=jsonb_set(snapshot,'{survey,siteName}','\"Tampered\"') WHERE id=$1",[working.id]),/locked/);
 const original=JSON.stringify(quote.snapshot),revision=await commercial.revisionStart(actor,quote.id,'Customer',false,'Equipment quantity change',role,randomUUID()),technical=await commercial.technicalRevision(actor,revision.id);
 assert.equal(technical.id,revision.id);assert.equal((await commercial.technicalRevision(actor,revision.id)).draft_id,technical.draft_id);
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM quotation_revision_requests')).rows[0].n,1);
 const td=(await boqs.drafts(actor)).find(d=>d.id===technical.draft_id)!,changed=surveySchema.parse({...td.inputs,directProducts:[{...survey.directProducts![0],qty:'4'}]}),saved=await boqs.draft(actor,td.id,td.version,changed,td.base_revision_id,td.revision_reason,td.revision_origin),bp=await boqs.preview(changed,td.base_revision_id),newBoq=await boqs.save(actor,saved.id,saved.version,bp.fingerprint,true);
 assert.equal((await commercial.revisionContext(actor,newBoq.id)).id,revision.id);assert.equal((await boqs.get(working.id)).snapshot.survey.directProducts[0].qty,'3');assert.equal(JSON.stringify((await commercial.quotationGet(quote.id)).snapshot),original);
 }finally{await db.close();}
});
