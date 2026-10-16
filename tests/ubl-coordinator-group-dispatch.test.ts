import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {ProjectWorkflowRepository} from '../server/project-workflow/repository.js';
import {customerSendEvidence,attachCustomerSendEvidence,sendPackageToCustomer} from '../server/project-workflow/ubl-customer-send.js';
import {readyPackages} from '../server/project-workflow/ready-send.js';

test('responsible Coordinator dispatches only an approved complete group with evidence, retaining its public group number and safe replay',async()=>{
 const db=await testDatabase();try{
 const admin=randomUUID(),atif=randomUUID(),other=randomUUID();
 for(const[id,role]of[[admin,'Admin'],[atif,'Coordinator'],[other,'Coordinator']])await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'test-only',$3)",[id,id+'@example.test',role]);
 const repo=new ProjectWorkflowRepository(db.pool),ids:string[]=[];
 for(const code of ['COORD-SEND-1','COORD-SEND-2'])ids.push((await repo.create(atif,{requestKey:randomUUID(),customerId:5,siteName:'Disposable '+code,siteCode:code,route:'survey-framework',notes:'Disposable group dispatch test'})).id);
 const packageId=randomUUID(),snapshot={sites:ids.map(recordId=>({recordId,excelRow:Array(22).fill('test')})),owner:atif};
 await db.pool.query("INSERT INTO ubl_survey_review_packages(id,request_key,created_by,status,snapshot,xlsx,report_pdf) VALUES($1,$2,$3,'Submitted for Management',$4,$5,$6)",[packageId,randomUUID(),atif,snapshot,Buffer.from('xlsx'),Buffer.from('%PDF-')]);
 for(const id of ids)await db.pool.query("UPDATE project_workflow_records SET stage='management_review',data=data||$2::jsonb WHERE id=$1",[id,JSON.stringify({ublSurveyPackageId:packageId,recommendationId:randomUUID(),basis:{source:{configurationKey:'25-20-30'},order:{solutionId:'25-20-30',allocation:{subtotal:'100',tax:'18',total:'118'}}}})]);
 await assert.rejects(customerSendEvidence(repo,atif,packageId),/approved survey group/);
 await db.pool.query("UPDATE project_workflow_records SET stage='approved_dispatch' WHERE id=ANY($1::uuid[])",[ids]);
 const group=(await db.pool.query("INSERT INTO survey_submission_groups(created_by,status,package_id) VALUES($1,'Submitted',$2) RETURNING sequence",[atif,packageId])).rows[0];
 const ready=(await readyPackages(repo,atif)).find((g:any)=>g.packageId===packageId);
 assert.equal(ready.number,'Approved Survey Group · SSG-'+String(group.sequence).padStart(5,'0'));
 assert.equal(ready.firstRecordId,ids[0]);assert.equal(ready.siteCount,2);assert.equal(ready.packageSiteCount,2);
 await db.pool.query("UPDATE project_workflow_records SET data=data||'{\"readySendUnbound\":true}'::jsonb WHERE id=$1",[ids[1]]);
 await assert.rejects(customerSendEvidence(repo,atif,packageId),/complete approved survey group/);
 await db.pool.query("UPDATE project_workflow_records SET data=data-'readySendUnbound' WHERE id=$1",[ids[1]]);
 await assert.rejects(customerSendEvidence(repo,other,packageId),/responsible coordinator/);
 await assert.rejects(attachCustomerSendEvidence(repo,admin,packageId,{filename:'mail.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4 evidence').toString('base64')}),/only the receiving department/);
 const body=()=>({requestKey:randomUUID(),confirmed:true,recipient:'UBL',notes:'Existing emailed dispatch; no heads-up or PO received.',versions:ids.map(id=>({id,version:1}))});
 await assert.rejects(sendPackageToCustomer(repo,atif,packageId,body()),/evidence/);
 await attachCustomerSendEvidence(repo,atif,packageId,{filename:'mail.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4 evidence').toString('base64')});
 const evidence=await customerSendEvidence(repo,atif,packageId);assert.equal(evidence.files.length,1);
 const stale=body();stale.versions[1].version=2;
 await assert.rejects(sendPackageToCustomer(repo,atif,packageId,stale),/changed/);
 assert.equal((await db.pool.query("SELECT count(*)::int n FROM project_workflow_records WHERE id=ANY($1::uuid[]) AND stage='approved_dispatch'",[ids])).rows[0].n,2);
 const command=body();await sendPackageToCustomer(repo,atif,packageId,command);
 assert.equal((await sendPackageToCustomer(repo,atif,packageId,command)).repeated,true);
 const saved=(await db.pool.query('SELECT stage,data FROM project_workflow_records WHERE id=ANY($1::uuid[])',[ids])).rows;
 assert.ok(saved.every(r=>r.stage==='customer_tracking'&&r.data.customerSendingEvidenceIds.length===1&&!r.data.headsupId&&!r.data.poId));
 assert.equal((await readyPackages(repo,atif)).some((g:any)=>g.packageId===packageId),false);
 const listed=await repo.list(atif,'coordination','mine');
 for(const id of ids)assert.equal((listed.records.find((r:any)=>r.id===id) as any)?.surveyBatchNumber,'SSG-'+String(group.sequence).padStart(5,'0'));
 }finally{await db.close();}
});
