import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {transaction} from '../server/db/transaction.js';
import {createDashboardSamples} from '../server/coordinator/samples.js';
import {projectOperationsClosureEvidence,operationsClosureEvidenceFile} from '../server/accounts/operations-evidence.js';
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');

test('Accounts reuses only exact linked completed Operations QC evidence, freezes provenance and ignores document-location-only changes',async()=>{
 const db=await testDatabase();try{
  const owner=randomUUID(),coord=randomUUID();for(const [id,role]of[[owner,'Admin'],[coord,'Coordinator']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);
  const examples=await createDashboardSamples(db.pool,coord,owner),sample=examples.find((r:any)=>r.ipoId)!;
  const ipo=(await db.pool.query('SELECT id,snapshot FROM internal_purchase_orders WHERE id=$1',[sample.ipoId])).rows[0],key='ipo:'+ipo.id,siteId='exact-closure-qc',foreign='foreign-qc';
  for(const id of[siteId,foreign])await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[id,owner]);
  const file=async(name:string,media:string,content:Buffer|string,site=siteId)=>{const id=randomUUID(),bytes=Buffer.from(content);await db.pool.query('INSERT INTO operations_board_files(id,site_id,filename,media_type,sha256,content,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,site,name,media,hash(bytes),bytes,owner]);return{id,name,mediaType:media};};
  const acknowledgement=await file('customer-ack.png','image/png',Buffer.from([137,80,78,71,13,10,26,10,1])),irr=await file('fixed-irr.pdf','application/pdf','%PDF-1.7 IRR'),variableSignoff=await file('variable-signoff.pdf','application/pdf','%PDF-1.7 VARIABLE'),photo=await file('mounted-system.jpg','image/jpeg',Buffer.from([255,216,255,224,1,2,3])),foreignPhoto=await file('another-site.jpg','image/jpeg',Buffer.from([255,216,255,224,4,5,6]),foreign);
  const final={date:'2026-10-27',evidence:photo,acknowledgement,irr,variableSignoff,checks:{mounting:true,electrical:true,testingTraining:true,signoff:true}};
  const base:any={id:siteId,ipo:'Displayed identifier never used to match',name:'Exact fixture',stage:'delivered',installation:true,completed:true,projectType:'ups',operationsTeam:'central',qcJob:final,privateCosts:'Do not project'};
  let version=0;const save=async(snapshot:any)=>{version++;await db.pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[siteId,version,snapshot,'Fixture evidence','Fictional closure evidence',randomUUID(),owner]);};await save(base);
  assert.equal((await projectOperationsClosureEvidence(db.pool,key)).source,null,'Display IPO/name never substitutes for an exact source link');
  await db.pool.query('INSERT INTO inventory_material_source_links(id,board_site_id,board_version,ipo_id,boq_revision_id,board_sha256,ipo_sha256,boq_sha256,reason,request_key,request_sha256,created_by) VALUES($1,$2,1,$3,$4,$5,$5,$5,$6,$7,$5,$8)',[randomUUID(),siteId,ipo.id,ipo.snapshot.boqRevisionId,'a'.repeat(64),'Exact approved fixture identity',randomUUID(),owner]);
  const initial=await projectOperationsClosureEvidence(db.pool,key);assert.equal(initial.hold,undefined);assert.ok(initial.signature);assert.equal(initial.source?.version,1);assert.equal(initial.evidence.length,4);assert.deepEqual(initial.evidence.map(e=>e.kind),['Client acknowledgment','IRR','Variable items sign-off','Site photographs']);
  assert.ok(!JSON.stringify(initial).includes('privateCosts'));assert.ok(!JSON.stringify(initial).includes('content'));assert.ok(!JSON.stringify(initial).includes('Displayed identifier'));
  const client=initial.evidence.find(e=>e.kind==='Client acknowledgment')!,picture=initial.evidence.find(e=>e.kind==='Site photographs')!;assert.equal(client.id,acknowledgement.id);assert.equal(picture.id,photo.id);assert.notEqual(picture.id,acknowledgement.id,'Signature image is never inferred to be a site photo');
  assert.match(picture.downloadUrl,/\/api\/accounts-workspace\/jobs\/ipo%3A/);assert.equal(picture.source.sha256,picture.sha256);
  assert.ok((await operationsClosureEvidenceFile(db.pool,key,picture.source)).content.equals(Buffer.from([255,216,255,224,1,2,3])));
  await assert.rejects(operationsClosureEvidenceFile(db.pool,key,{...picture.source,fileId:foreignPhoto.id}),/not found/);
  await assert.rejects(operationsClosureEvidenceFile(db.pool,'ipo:'+randomUUID(),picture.source),/not found/);
  await assert.rejects(operationsClosureEvidenceFile(db.pool,key,{...picture.source,sha256:'f'.repeat(64)}),/not found/);
  await assert.rejects(projectOperationsClosureEvidence(db.pool,key,{lock:true}),/transaction client/);
  const locked=await transaction(db.pool,async c=>{
   const result=await projectOperationsClosureEvidence(c,key,{lock:true}),writer=await db.pool.connect();
   try{await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='100ms'");await assert.rejects(writer.query('SELECT id FROM operations_board_sites WHERE id=$1 FOR UPDATE',[siteId]),(error:any)=>error.code==='55P03','Closure evidence share lock blocks concurrent QC site correction');}finally{await writer.query('ROLLBACK');writer.release();}return result;
  });assert.equal(locked.signature,initial.signature);
  await save({...base,documents:[{id:'physical-tracking',label:'Original signoffs',date:'2026-10-27',location:'Submitted to Accounts',evidence:[]}],documentsSubmittedToAccounts:true});
  const location=await projectOperationsClosureEvidence(db.pool,key);assert.equal(location.source?.version,2);assert.equal(location.signature,initial.signature,'Physical tracking does not invalidate identical completion evidence');
  const correctedPhoto=await file('corrected-system.jpg','image/jpeg',Buffer.from([255,216,255,224,7,8,9]));await save({...base,qcJob:{...final,evidence:correctedPhoto}});
  assert.notEqual((await projectOperationsClosureEvidence(db.pool,key)).signature,initial.signature,'A changed QC image invalidates the reviewed evidence signature');
  assert.ok((await operationsClosureEvidenceFile(db.pool,key,picture.source)).content.length,'Frozen old version remains privately downloadable by an authorized caller');
  await save({...base,qcJob:{...final,date:'2026-10-26'}});assert.notEqual((await projectOperationsClosureEvidence(db.pool,key)).signature,initial.signature);
  for(const [snapshot,pattern]of[
   [{...base,completed:false},/completion/],
   [{...base,installation:false,projectType:'delivery-only'},/installation scope/],
   [{...base,projectType:null},/project type/],
   [{...base,qcJob:{...final,checks:{...final.checks,testingTraining:false}}},/checks/],
   [{...base,qcJob:{...final,variableSignoff:undefined}},/variable-items sign-off/],
   [{...base,qcJob:{...final,evidence:foreignPhoto}},/another site/],
   [{...base,qcJob:{...final,evidence:acknowledgement}},/actual QC site photograph/],
   [{...base,qcJob:{...final,evidence:irr}},/actual QC site photograph/],
   [{...base,qcJob:undefined,documents:[{id:'legacy-handover',label:'Acknowledgement IRR',location:'Submitted to Accounts',date:'2026-10-27',evidence:[acknowledgement,irr,variableSignoff]}]},/typed QC stages/],
  ] as const){await save(snapshot);const held=await projectOperationsClosureEvidence(db.pool,key);assert.deepEqual(held.evidence,[]);assert.equal(held.signature,null);assert.match(held.hold!,pattern);assert.ok(held.source);}
  await save({...base,qcJob:{...final,irr:undefined}});assert.equal((await projectOperationsClosureEvidence(db.pool,key)).hold,undefined,'New completions do not require an IRR');
  await save({...base,qcJob:{...final,irr:undefined,variableSignoff:undefined,noVariableItemsUsed:true}});const noUse=await projectOperationsClosureEvidence(db.pool,key);assert.equal(noUse.hold,undefined);assert.equal(noUse.evidence.some(e=>e.kind==='Variable items sign-off'),false);
  const invalidMime=await file('pretends-image.png','image/png','%PDF-actually-a-document');await save({...base,qcJob:{...final,evidence:invalidMime}});assert.match((await projectOperationsClosureEvidence(db.pool,key)).hold!,/actual QC site photograph/);
  for(const type of ['solar','solar-bess','bess']){
   const stages=type==='bess'?['cabinet','panel','bessTesting','handover']:['civil','electrical','testing','signoff'],qc=Object.fromEntries(stages.map((stage,i)=>[stage,i===3?{date:'2026-10-27',acknowledgement,irr,variableSignoff}:{date:'2026-10-26',evidence:photo}]));await save({...base,projectType:type,qcJob:undefined,qc});const result=await projectOperationsClosureEvidence(db.pool,key);assert.equal(result.hold,undefined);assert.ok(result.signature);assert.equal(result.evidence.filter(e=>e.kind==='Site photographs').length,1);
  }
  assert.equal((await projectOperationsClosureEvidence(db.pool,'ubl:1')).source,null);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM job_closure_evidence')).rows[0].n,0,'Projection creates no copies of evidence');
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM accounts_job_closures')).rows[0].n,0,'Projection never submits costing or invoices');
 }finally{await db.close();}
});
