import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {testDatabase} from './database.js';
import {createDashboardSamples} from '../server/coordinator/samples.js';
import {ProjectWorkflowRepository} from '../server/project-workflow/repository.js';
import {batchedDecorateLookups,directDecorateLookups} from '../server/project-workflow/decorate-lookups.js';
import {assertBatchedListMatchesDirect} from './project-list-equivalence.js';

function counting(pool:Pool){
  let queries=0;
  const counted=new Proxy(pool,{get(target,key){
    if(key==='query')return (...args:any[])=>{queries++;return (target.query as any)(...args);};
    const value=(target as any)[key];return typeof value==='function'?value.bind(target):value;
  }});
  return {pool:counted as Pool,count:()=>queries,reset:()=>{queries=0;}};
}

test('department lists are identical with batched lookups and use a handful of queries instead of one set per project',async()=>{
 const db=await testDatabase();try{
  const coord=randomUUID(),design=randomUUID(),manager=randomUUID();
  for(const [id,role] of [[coord,'Coordinator'],[design,'Design'],[manager,'Management']])await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated',$4)",[id,id+'@example.test',role,role]);
  const samples:any[]=await createDashboardSamples(db.pool,coord,manager);
  const stages=['request_review','survey_requested','survey_scheduled','technical_review','technical_revision','commercial_revision','approved_dispatch','customer_tracking','order_exception','deferred'];
  let n=0;
  const repo=new ProjectWorkflowRepository(db.pool),counter=counting(db.pool),countedRepo=new ProjectWorkflowRepository(counter.pool);
  const queries=async(mode:'batched'|'direct')=>{counter.reset();await countedRepo.list(coord,'coordination','mine',mode);return counter.count();};
  const rounds:{records:number;batched:number;direct:number}[]=[];
  // Samples come in pairs at the same BOQ/quotation stage, so the even and odd
  // halves contain the same mix of projects: the second half doubles the list.
  for(const half of [0,1]){
   for(const [index,sample] of samples.entries()){
    if(index%2!==half)continue;
    for(const variant of [0,1]){
     const pair=Math.floor(index/2),stage=stages[(pair*2+variant)%stages.length],id=randomUUID();
     // Variant 1 knows only the latest quotation (no draft), variant 0 the draft and the quotation.
     const data:any=variant?{latestQuotationId:sample.quotationId}:{draftId:sample.draftId,latestQuotationId:sample.quotationId,scheduledSurveyDate:'2026-01-0'+(1+pair%9)};
     if(!data.latestQuotationId)delete data.latestQuotationId;
     if(variant&&!sample.quotationId)data.draftId=sample.draftId;
     await db.pool.query("INSERT INTO project_workflow_records(id,customer_id,site_name,site_code,route,stage,coordinator_id,planning_owner_id,data,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$7)",
      [id,sample.customerId,'Batch list '+n,'BL'+n,variant?'quick-quote':'survey-framework',stage,coord,design,data,randomUUID()]);
     n++;
    }
   }
   rounds.push({records:n,batched:await queries('batched'),direct:await queries('direct')});
  }
  assert.ok(n>=20);
  const coordination=await assertBatchedListMatchesDirect(repo,coord,'coordination','mine');
  assert.ok(coordination.records.length>=20);
  assert.ok(coordination.records.some((r:any)=>r.quotation),'Fixture covers records with quotations');
  assert.ok(coordination.records.some((r:any)=>r.task?.kind==='Survey / BOQ'),'Fixture covers records without a finalized BOQ');
  await assertBatchedListMatchesDirect(repo,design,'design','mine');
  await assertBatchedListMatchesDirect(repo,manager,'coordination','team');
  // Doubling the projects adds several queries per project to the record-by-record
  // list, but (almost) none to the batched list.
  const [half,full]=rounds,detail=JSON.stringify(rounds);
  assert.ok(full.direct-half.direct>=(full.records-half.records)*3,'record-by-record list grows per project '+detail);
  assert.ok(full.batched-half.batched<=5,'batched list does not grow per project '+detail);
  assert.ok(full.batched*3<full.direct,'batched list uses far fewer queries '+detail);
  console.log('project list queries',detail);
 }finally{await db.close();}
});

test('batched lookups return each record its own copy of exactly the direct rows',async()=>{
 const db=await testDatabase();try{
  const coord=randomUUID(),manager=randomUUID();
  for(const [id,role] of [[coord,'Coordinator'],[manager,'Management']])await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated',$4)",[id,id+'@example.test',role,role]);
  const samples:any[]=await createDashboardSamples(db.pool,coord,manager);
  const quoted=samples.filter(s=>s.quotationId);
  const direct=directDecorateLookups(db.pool),batched=batchedDecorateLookups(db.pool);
  const keys=[...quoted.map(s=>s.quotationId),quoted[0].quotationId,randomUUID()];
  const together=await Promise.all(keys.map(k=>batched.quotationStatus(k)));
  for(const [index,key] of keys.entries())assert.deepEqual(together[index],await direct.quotationStatus(key),key);
  assert.notEqual(together[0],together[quoted.length],'Repeated keys get separate copies');
  assert.equal(together.at(-1),undefined,'Unknown key has no row, as before');
  // A missing value matches nothing, exactly as the original query, without a database trip.
  const counter=counting(db.pool),noTrips=batchedDecorateLookups(counter.pool);
  assert.equal(await noTrips.finalization(undefined),await direct.finalization(undefined));
  assert.equal(await noTrips.quotationStatus(null),await direct.quotationStatus(null));
  assert.deepEqual(await noTrips.references(null),await direct.references(null));
  assert.deepEqual(await noTrips.readyGroupCount(null),await direct.readyGroupCount(null));
  assert.equal(counter.count(),0,'Missing values need no database trip');
  assert.equal(await batched.today(),await direct.today());
  await assert.rejects(Promise.all([batched.quotationRevision('not-a-uuid'),batched.quotationRevision(randomUUID())]),'An invalid value still fails, as the original query did');
 }finally{await db.close();}
});
