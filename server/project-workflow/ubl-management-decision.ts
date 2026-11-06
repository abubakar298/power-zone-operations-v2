import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction} from '../db/transaction.js';
import {fingerprint} from '../boq/repository.js';
import {HttpError} from '../http/errors.js';

/** Decide the exact submitted package atomically; retain its Excel/PDF snapshot. */
export async function decideUblSurveyPackage(repo:any,actor:string,packageId:string,raw:unknown){
 const input=z.object({requestKey:z.uuid(),decision:z.enum(['Approved','Changes requested']),notes:z.string().trim().min(1).max(4000),versions:z.array(z.object({id:z.uuid(),version:z.number().int().positive()}).strict()).min(1).max(50)}).strict().parse(raw);
 return transaction(repo.pool,async(c:any)=>{
  await c.query('SELECT pg_advisory_xact_lock(742019004)');
  const user=await repo.user(actor,c);
  if(!['Admin','Management'].includes(user.role))throw new HttpError(403,'Survey package decisions require Management access.');
  const pkg=(await c.query('SELECT * FROM ubl_survey_review_packages WHERE id=$1',[packageId])).rows[0];
  if(!pkg||pkg.status!=='Submitted for Management'||!pkg.xlsx||!pkg.report_pdf)throw new HttpError(409,'Choose a submitted package with its saved report and Excel file.');
  const packageIds=new Set(pkg.snapshot.sites.map((s:any)=>s.recordId));const ids=input.versions.map(v=>v.id).sort();
  if(new Set(ids).size!==ids.length||ids.some(id=>!packageIds.has(id)))throw new HttpError(409,'Review only selected sites from the exact submitted package.');
  const fp=fingerprint({packageId,...input});
  const repeated=(await c.query('SELECT record_id,created_by,input_fingerprint FROM project_workflow_events WHERE request_key=$1',[input.requestKey])).rows[0];
  if(repeated){if(repeated.created_by!==actor||repeated.input_fingerprint!==fp||!ids.includes(repeated.record_id))throw new HttpError(409,'Request key belongs to another decision.');return{packageId,decision:input.decision,siteCount:ids.length,repeated:true};}
  const records=[];
  for(const id of ids){const {r}=await repo.record(actor,id,c,true);if(r.stage!=='management_review'||r.data.ublSurveyPackageId!==packageId||r.version!==input.versions.find(v=>v.id===id)?.version)throw new HttpError(409,'A package site changed. Reload and review before deciding.');records.push(r);}
  for(const [index,r] of records.entries()){
   const stage=input.decision==='Approved'?'approved_dispatch':'commercial_revision';
   const data={...r.data,ublSurveyPackageStatus:input.decision,ublManagementDecision:{packageId,decision:input.decision,notes:input.notes,actor,sourceVersion:r.version,at:new Date().toISOString()}};
   if(input.decision==='Changes requested')Object.assign(data,{returnReason:input.notes,returnSourceVersion:r.version,revisionCategory:'Internal correction'});
   await repo.document(c,r,actor,'UBL survey Management decision',{packageId,decision:input.decision,notes:input.notes,sourceVersion:r.version});
   await c.query('UPDATE project_workflow_records SET stage=$2,data=$3,version=version+1,updated_at=now() WHERE id=$1',[r.id,stage,data]);
   await c.query('INSERT INTO project_workflow_events(id,record_id,version,action,snapshot,request_key,input_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),r.id,r.version+1,'management-survey-decision',{stage,reason:input.notes,data},index===0?input.requestKey:randomUUID(),fp,actor]);
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`project.workflow.management-survey-decision:${r.id}:v${r.version+1}:${input.decision}`]);
  }
  return{packageId,decision:input.decision,siteCount:records.length,repeated:false};
 });
}
