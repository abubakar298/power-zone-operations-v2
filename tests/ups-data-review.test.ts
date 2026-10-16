import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {correctUpsReviewSnapshot,dataReviewRows,missingReviewFields,saveUpsDataReview,upsDataReview} from '../server/director/ups-data-review.js';
import {upsBatchProgress} from '../server/director/ups-progress.js';
import {upsActiveRegister} from '../server/director/ups-register.js';
import {testDatabase} from './database.js';
import express from 'express';import request from 'supertest';import {directorHttp} from '../server/director/http.js';
const key='UPS:UBL:CHP-999';
const snapshot=()=>({totalSites:250,managementRegister:{customer:'UBL',configuration:'6-10',projectReference:'CHP-999',totalSites:250,source:{filename:'Preserved.xlsx'},unreviewedCosting:{status:'Unreviewed',ledgerTransactions:[{amount:'4505.14'}]},sites:[{orderNumber:'65/250',siteName:'Old name',recoveryStatus:{deliveryStatus:'Delivered',installationStatus:'Completed',systemPaymentStatus:'Unverified',costingIgnored:true,dataRequired:{fields:['Installation completion date','System invoice reference']}}},{orderNumber:'86/250',siteName:'Review site',recoveryStatus:{deliveryStatus:'Delivered',installationStatus:'Review needed',systemPaymentStatus:'Unverified'}},{orderNumber:'1/250',siteName:'Financially closed',recoveryStatus:{dataRequired:{fields:['Test protected closure']}}}],completionConfirmations:{'65/250':{status:'Completed',completionDate:null}},completionApprovals:{'1/250':{actualCost:{amount:'700000.00'}}},installationAlerts:{'86/250':{status:'Review needed by Accounts',reason:'Conflicting installation evidence'}}}});
const values=()=>({siteName:'Correct site',deliveryStatus:'Delivered',installationStatus:'Completed',deliveryDate:'2026-09-01',installationDate:'2026-09-02',ipoSharedDate:null,invoiceReference:'INV65',invoiceAmount:'450000.00',invoiceStatus:'Submitted',invoiceSubmittedDate:'2026-09-03',paymentStatus:'Pending',paymentReceivedDate:null,paymentReceivedAmount:'',delayOwner:'Unclassified'});
const input=()=>({programKey:key,expectedVersion:8,orderNumber:'65/250',values:values(),notes:'Verified against the source documents.'});
const now=new Date('2026-10-17T06:00:00Z');
test('data review POST requires the current session CSRF token',async()=>{
 let calls=0;const repo={saveUpsDataReview:async()=>{calls++;return {saved:true};}};
 const app=express();app.use(express.json());app.use(directorHttp(repo as any,(req,_res,next)=>{req.authSession={user:{id:'isolated-management'},csrfToken:'isolated-csrf'} as any;next();}));app.use((e:any,_req:any,res:any,_next:any)=>res.status(e.status??500).json({message:e.message}));
 await request(app).post('/ups-data-review').send({}).expect(403);assert.equal(calls,0);
 await request(app).post('/ups-data-review').set('X-CSRF-Token','isolated-csrf').send({}).expect(200);assert.equal(calls,1);
});
test('complete missing details preserves costing and approved closures and retains Completed stage',()=>{
 const old=snapshot(),before=structuredClone(old),change=correctUpsReviewSnapshot(old,input(),'management',now);
 assert.deepEqual(old,before);assert.equal(change.unchanged,false);
 const r=change.snapshot.managementRegister;
 assert.deepEqual(r.completionApprovals,old.managementRegister.completionApprovals);assert.deepEqual(r.unreviewedCosting,old.managementRegister.unreviewedCosting);
 assert.equal(r.sites[0].recoveryStatus.costingIgnored,true);assert.equal(r.sites[0].recoveryStatus.dataRequired,undefined);assert.equal(r.sites[0].recoveryStatus.dataReview.originalRecoveryStatus.systemPaymentStatus,'Unverified');
 assert.equal(upsBatchProgress(r).completed,2);assert.equal(upsBatchProgress(r).completedInvoicesSubmitted,1);
 const report=dataReviewRows([{program_key:key,version:9,snapshot:change.snapshot}]);assert.equal(report.find(r=>r.orderNumber==='65/250')!.status,'Completed');assert.equal(report.find(r=>r.orderNumber==='65/250')!.resolved,true);
 const register=upsActiveRegister([{program_key:key,version:9,snapshot:change.snapshot}],[]);assert.equal(register.rows.find(r=>r.orderNumber==='65/250').status,'Completed');assert.equal(register.rows.find(r=>r.orderNumber==='65/250').completion,undefined);
});
test('partial corrections remain flagged; a corrected wrong stage moves operationally without financial closure',()=>{
 const request=input();request.values.installationStatus='Pending';request.values.installationDate=null as any;request.values.deliveryDate=null as any;request.values.invoiceReference='';request.values.invoiceAmount='';
 const change=correctUpsReviewSnapshot(snapshot(),request,'manager',now),r=change.snapshot.managementRegister,s=upsBatchProgress(r);
 assert.equal(r.completionConfirmations['65/250'],undefined);assert.equal(s.completed,1);assert.equal(s.delivered,1);assert.equal(s.deliveryAgeing[0].band,'unknown');assert.equal(r.sites[0].recoveryStatus.systemInvoices.length,0);assert.ok(r.sites[0].recoveryStatus.dataRequired.fields.includes('Delivery date'));
 assert.deepEqual(r.completionApprovals,snapshot().managementRegister.completionApprovals);
});
test('resolving Accounts review removes its alert from stage classification and preserves evidence',()=>{
 const request={...input(),orderNumber:'86/250'};const r=correctUpsReviewSnapshot(snapshot(),request,'manager',now).snapshot.managementRegister;
 assert.ok(r.installationAlerts['86/250'].resolvedAt);assert.equal(r.installationAlerts['86/250'].reason,'Conflicting installation evidence');assert.equal(upsBatchProgress(r).reviewRequired,0);assert.equal(upsBatchProgress(r).completed,3);assert.equal(r.completionApprovals['86/250'],undefined);
});
test('invalid status combinations, future dates, mismatched payments and financial closure edits are rejected',()=>{
 assert.throws(()=>correctUpsReviewSnapshot(snapshot(),{...input(),orderNumber:'1/250'},'manager',now),/financial closure/);
 assert.throws(()=>correctUpsReviewSnapshot(snapshot(),{...input(),values:{...values(),deliveryStatus:'Not delivered'}},'manager',now),/must be marked delivered/);
 assert.throws(()=>correctUpsReviewSnapshot(snapshot(),{...input(),values:{...values(),deliveryDate:'2027-01-01'}},'manager',now),/future/);
 assert.throws(()=>correctUpsReviewSnapshot(snapshot(),{...input(),values:{...values(),installationDate:'2026-08-01'}},'manager',now),/before delivery/);
 assert.throws(()=>correctUpsReviewSnapshot(snapshot(),{...input(),values:{...values(),paymentStatus:'Received',paymentReceivedAmount:'100'}},'manager',now),/fully paid/);
});
test('saving appends a guarded immutable version; retry is idempotent; stale or unauthorised saves write nothing',async()=>{
 const db=await testDatabase();try{
  const actor=randomUUID(),atif=randomUUID();for(const [id,role]of[[actor,'Management'],[atif,'Coordinator']])await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash)VALUES($1,$2,'Data review test',$3,'test-only')",[id,id+'@test.invalid',role]);
  await db.pool.query('INSERT INTO ups_management_program_versions(id,program_key,version,customer_code,snapshot,notes,created_by)VALUES($1,$2,8,$3,$4,$5,$6)',[randomUUID(),key,'UBL',snapshot(),'Preserved source',actor]);
  const protectedTables=['sites','project_workflow_records','internal_purchase_orders','accounts_job_closures','ups_management_budget_versions','document_sequences'];
  const fingerprint=async()=>Object.fromEntries(await Promise.all(protectedTables.map(async t=>[t,(await db.pool.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,'')) AS hash FROM ${t} r`)).rows[0].hash])));
  const before=await fingerprint();await assert.rejects(upsDataReview(db.pool,atif,'UBL'),/Management access/);await assert.rejects(saveUpsDataReview(db.pool,atif,input()),/Management access/);
  const saved=await saveUpsDataReview(db.pool,actor,input());assert.equal(saved.version,9);assert.equal(saved.unchanged,false);
  const retry=await saveUpsDataReview(db.pool,actor,input());assert.equal(retry.version,9);assert.equal(retry.unchanged,true);
  await assert.rejects(saveUpsDataReview(db.pool,actor,{...input(),values:{...values(),siteName:'Concurrent overwrite'}}),/register changed/);
  const versions=(await db.pool.query('SELECT version,snapshot FROM ups_management_program_versions WHERE program_key=$1 ORDER BY version',[key])).rows;assert.equal(versions.length,2);assert.deepEqual(versions[0].snapshot,snapshot());assert.deepEqual(await fingerprint(),before);
  const rows=await upsDataReview(db.pool,actor,'UBL');assert.equal(rows.rows.find(r=>r.orderNumber==='65/250')!.resolved,true);assert.deepEqual(missingReviewFields(values() as any),[]);
 }finally{await db.close();}
});
