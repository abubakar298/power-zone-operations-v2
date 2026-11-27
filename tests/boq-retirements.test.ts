import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {createDashboardSamples} from '../server/coordinator/samples.js';
import {CoordinatorRepository} from '../server/coordinator/repository.js';
import {retireBoqRevision} from '../server/coordinator/boq-retirements.js';

// User decision, 27 Nov 2026: a duplicate approved BOQ that will never be priced can be marked "Not needed".
test('a BOQ marked not needed leaves Design Review, is kept, and only unused BOQs of your own can be marked',async()=>{
 const db=await testDatabase();try{
  const c=db.pool,owner=randomUUID(),manager=randomUUID(),other=randomUUID(),design=randomUUID();
  for(const [id,role]of [[owner,'Coordinator'],[manager,'Management'],[other,'Coordinator'],[design,'Design']])await c.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated',$4)",[id,`${id}@example.test`,role,role]);
  const records=await createDashboardSamples(c,owner,manager);
  const [unused,kept]=records.filter((r:any)=>r.stage===2),priced=records.find((r:any)=>r.stage===3)!;
  const listed=async(id:string)=>(await new CoordinatorRepository(c).overview(owner,false,true)).tasks.some((t:any)=>t.kind==='Commercial pricing'&&t.id===id);
  assert.equal(await listed(unused.boqRevisionId),true);
  const body={reason:'Replaced by the full site survey',requestKey:randomUUID()};
  await assert.rejects(retireBoqRevision(c,design,unused.boqRevisionId,body),/Coordination or Management/);
  await assert.rejects(retireBoqRevision(c,other,unused.boqRevisionId,body),/coordinator of this BOQ/);
  await assert.rejects(retireBoqRevision(c,owner,unused.boqRevisionId,{reason:'no',requestKey:randomUUID()}));
  await assert.rejects(retireBoqRevision(c,owner,priced.boqRevisionId,{...body,requestKey:randomUUID()}),/already has pricing/);
  const retired=await retireBoqRevision(c,owner,unused.boqRevisionId,body);assert.equal(retired.reason,body.reason);
  assert.equal((await retireBoqRevision(c,owner,unused.boqRevisionId,body)).revision_id,unused.boqRevisionId,'same click again returns the same result');
  await assert.rejects(retireBoqRevision(c,manager,unused.boqRevisionId,{...body,requestKey:randomUUID()}),/already marked/);
  assert.equal(await listed(unused.boqRevisionId),false,'retired BOQ leaves Design Review');
  assert.equal(await listed(kept.boqRevisionId),true,'other BOQs stay');
  assert.equal((await c.query('SELECT count(*)::int n FROM boq_revisions WHERE id=$1',[unused.boqRevisionId])).rows[0].n,1,'the BOQ is kept');
  assert.equal((await c.query("SELECT count(*)::int n FROM audit_log WHERE user_id=$1 AND action LIKE 'boq.retired:%'",[owner])).rows[0].n,1);
  await assert.rejects(c.query("UPDATE boq_retirements SET reason='changed' WHERE revision_id=$1",[unused.boqRevisionId]));
  // Management can mark any coordinator's unused BOQ.
  await retireBoqRevision(c,manager,kept.boqRevisionId,{...body,requestKey:randomUUID()});
  assert.equal(await listed(kept.boqRevisionId),false);
 }finally{await db.close();}
});
