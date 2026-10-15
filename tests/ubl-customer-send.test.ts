import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {testDatabase} from './database.js';import {ProjectWorkflowRepository} from '../server/project-workflow/repository.js';import {customerSendEvidence,attachCustomerSendEvidence,removeCustomerSendEvidence,sendPackageToCustomer} from '../server/project-workflow/ubl-customer-send.js';
test('Management customer send preserves flags, requires active evidence, locks exact package versions and sends all sites atomically with safe retry',async()=>{
 const db=await testDatabase();try{
 const admin=randomUUID(),atif=randomUUID();for(const [id,role] of [[admin,'Admin'],[atif,'Coordinator']])await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'test-only',$3)",[id,`${id}@example.test`,role]);
 const repo=new ProjectWorkflowRepository(db.pool),ids:string[]=[];for(const code of ['0001','0002']){const r=await repo.create(atif,{requestKey:randomUUID(),customerId:5,siteName:'Disposable customer send '+code,siteCode:'SEND-'+code,route:'survey-framework',notes:'Disposable test only'});ids.push(r.id);}
 const packageId=randomUUID(),snapshot={sites:ids.map(recordId=>({recordId})),owner:atif};
 await db.pool.query("INSERT INTO ubl_survey_review_packages(id,request_key,created_by,status,snapshot,xlsx,report_pdf) VALUES($1,$2,$3,'Submitted for Management',$4,$5,$6)",[packageId,randomUUID(),atif,snapshot,Buffer.from('xlsx'),Buffer.from('%PDF-')]);
 for(const id of ids)await db.pool.query("UPDATE project_workflow_records SET stage='management_review',data=data||$2::jsonb WHERE id=$1",[id,JSON.stringify({ublSurveyPackageId:packageId,recommendationId:randomUUID(),ublStandardsReview:{needsReview:true,message:'Discuss with UBL Management'}})]);
 const body=()=>({requestKey:randomUUID(),confirmed:true,recipient:'UBL',notes:'Director reviewed and sent',versions:ids.map(id=>({id,version:1}))});
 await assert.rejects(customerSendEvidence(repo,atif,packageId));
 await assert.rejects(sendPackageToCustomer(repo,admin,packageId,body()),/evidence/);
 const file=await attachCustomerSendEvidence(repo,admin,packageId,{filename:'email.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4 disposable evidence').toString('base64')});
 await removeCustomerSendEvidence(repo,admin,packageId,file.id);assert.equal((await customerSendEvidence(repo,admin,packageId)).files.length,0);
 await assert.rejects(sendPackageToCustomer(repo,admin,packageId,body()),/evidence/);
 await attachCustomerSendEvidence(repo,admin,packageId,{filename:'email.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4 disposable evidence').toString('base64')});assert.equal((await customerSendEvidence(repo,admin,packageId)).files.length,1);
 const bad=body();bad.versions[1].version=2;await assert.rejects(sendPackageToCustomer(repo,admin,packageId,bad),/changed/);assert.equal((await db.pool.query("SELECT count(*)::int n FROM project_workflow_records WHERE stage='customer_tracking' AND id=ANY($1::uuid[])",[ids])).rows[0].n,0);
 const command=body();await sendPackageToCustomer(repo,admin,packageId,command);assert.equal((await sendPackageToCustomer(repo,admin,packageId,command)).repeated,true);
 const rows=(await db.pool.query('SELECT stage,data FROM project_workflow_records WHERE id=ANY($1::uuid[])',[ids])).rows;assert.ok(rows.every(r=>r.stage==='customer_tracking'&&r.data.ublStandardsReview.needsReview&&r.data.customerSendingEvidenceIds.length===1));
 await assert.rejects(removeCustomerSendEvidence(repo,admin,packageId,file.id),/preserved/);assert.equal((await customerSendEvidence(repo,admin,packageId)).sent,true);
 }finally{await db.close();}
});
