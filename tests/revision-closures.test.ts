import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {createDashboardSamples} from '../server/coordinator/samples.js';
import {CoordinatorRepository} from '../server/coordinator/repository.js';
import {closeRevisionRequest} from '../server/coordinator/revision-closures.js';

// Close a revision resolved outside the portal (user request, 25 Nov 2026): it leaves the Revisions tab, nothing is deleted.
test('closing a revision removes it from Revisions, keeps the request and reason, and is limited to its coordinator or Management',async()=>{
 const db=await testDatabase();try{
  const c=db.pool,owner=randomUUID(),manager=randomUUID(),other=randomUUID(),design=randomUUID();
  for(const [id,role]of [[owner,'Coordinator'],[manager,'Management'],[other,'Coordinator'],[design,'Design']])await c.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated',$4)",[id,`${id}@example.test`,role,role]);
  const records=await createDashboardSamples(c,owner,manager),record=records.find((r:any)=>r.stage===4)!;
  const request=randomUUID();
  await c.query("INSERT INTO quotation_revision_requests(id,source_quotation_id,origin,costing_change,reason,requested_by,created_by,request_key) VALUES($1,$2,'Customer',false,'Customer asked for a lower price','Customer',$3,$4)",[request,record.quotationId,owner,randomUUID()]);
  const listed=async()=>(await new CoordinatorRepository(c).overview(owner,false)).tasks.some((t:any)=>t.id===request&&t.kind==='Quotation revision');
  assert.equal(await listed(),true);
  const key=randomUUID(),body={reason:'Resolved with the customer by phone',requestKey:key};
  await assert.rejects(closeRevisionRequest(c,design,request,body),/Coordination or Management/);
  await assert.rejects(closeRevisionRequest(c,other,request,body),/coordinator of this revision/);
  await assert.rejects(closeRevisionRequest(c,owner,request,{reason:'no',requestKey:key}));
  const closed=await closeRevisionRequest(c,owner,request,body);assert.equal(closed.reason,body.reason);
  // Same click again returns the same result; a new close of a closed revision is refused.
  assert.equal((await closeRevisionRequest(c,owner,request,body)).request_id,request);
  await assert.rejects(closeRevisionRequest(c,manager,request,{...body,requestKey:randomUUID()}),/not open/);
  assert.equal(await listed(),false);
  assert.equal((await c.query('SELECT count(*)::int n FROM quotation_revision_requests WHERE id=$1',[request])).rows[0].n,1,'the request is kept');
  assert.equal((await c.query('SELECT count(*)::int n FROM quotation_revision_requests_current WHERE id=$1',[request])).rows[0].n,0);
  assert.equal((await c.query("SELECT count(*)::int n FROM audit_log WHERE user_id=$1 AND action LIKE 'quotation.revision-request.closed:%'",[owner])).rows[0].n,1);
  await assert.rejects(c.query("UPDATE quotation_revision_closures SET reason='changed' WHERE request_id=$1",[request]));
  // A revision that already produced a revised quotation cannot be closed.
  const linked=randomUUID();
  await c.query("INSERT INTO quotation_revision_requests(id,source_quotation_id,origin,costing_change,reason,requested_by,created_by,request_key) VALUES($1,$2,'Customer',false,'Second request','Customer',$3,$4)",[linked,record.quotationId,owner,randomUUID()]);
  await c.query('INSERT INTO quotation_revision_links(quotation_id,request_id) VALUES($1,$2)',[record.quotationId,linked]);
  await assert.rejects(closeRevisionRequest(c,manager,linked,{reason:'Not needed any more',requestKey:randomUUID()}),/already produced a revised quotation/);
 }finally{await db.close();}
});

// User report, 27 Nov 2026: after Close revision, the revision's own BOQ draft ("Draft") and its approved revised BOQ
// ("Approved BOQ: prepare pricing") stayed in Design Review. They now leave the lists with the request; the source
// quotation returns to its normal step, and unrelated drafts and BOQs are unaffected.
test('closing a revision also removes its BOQ draft and its revised BOQ from the work lists',async()=>{
 const db=await testDatabase();try{
  const c=db.pool,owner=randomUUID(),manager=randomUUID();
  for(const [id,role]of [[owner,'Coordinator'],[manager,'Management']])await c.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated',$4)",[id,`${id}@example.test`,role,role]);
  const records=await createDashboardSamples(c,owner,manager);
  const quote=records.find((r:any)=>r.stage===4)!,[draftOnly,otherDraft]=records.filter((r:any)=>r.stage===0),[approvedBoq,otherBoq]=records.filter((r:any)=>r.stage===2);
  const draftRequest=randomUUID(),boqRequest=randomUUID();
  for(const [id,draft]of [[draftRequest,draftOnly.draftId],[boqRequest,approvedBoq.draftId]])await c.query("INSERT INTO quotation_revision_requests(id,source_quotation_id,origin,costing_change,reason,requested_by,created_by,request_key,draft_id) VALUES($1,$2,'Customer',true,'Customer changed the load','Customer',$3,$4,$5)",[id,quote.quotationId,owner,randomUUID(),draft]);
  const tasks=async()=>(await new CoordinatorRepository(c).overview(owner,false,true)).tasks;
  const has=(list:any[],kind:string,id:string)=>list.some((t:any)=>t.kind===kind&&t.id===id);
  let list=await tasks();
  assert.equal(has(list,'Survey / BOQ',draftOnly.draftId),false,'an open revision keeps its draft under the revision');
  assert.equal(has(list,'Sale confirmation',quote.quotationId),false);
  for(const request of [draftRequest,boqRequest])await closeRevisionRequest(c,owner,request,{reason:'Resolved with the customer by phone',requestKey:randomUUID()});
  list=await tasks();
  assert.equal(has(list,'Survey / BOQ',draftOnly.draftId),false,'closed revision draft is not listed');
  assert.equal(has(list,'Commercial pricing',approvedBoq.boqRevisionId),false,'closed revision BOQ is not listed');
  assert.equal(has(list,'Sale confirmation',quote.quotationId),true,'the source quotation returns to its normal step');
  assert.equal(has(list,'Survey / BOQ',otherDraft.draftId),true,'unrelated drafts stay');
  assert.equal(has(list,'Commercial pricing',otherBoq.boqRevisionId),true,'unrelated approved BOQs stay');
 }finally{await db.close();}
});
