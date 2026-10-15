import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';
import {fingerprint} from '../boq/repository.js';
async function packageRecord(repo:any,actor:string,id:string,c=repo.pool){
 const u=await repo.user(actor,c);if(!['Admin','Management'].includes(u.role))throw new HttpError(403,'Management access required.');
 const pkg=(await c.query('SELECT * FROM ubl_survey_review_packages WHERE id=$1',[id])).rows[0];
 if(!pkg||pkg.status!=='Submitted for Management'||!pkg.snapshot.sites.length)throw new HttpError(404,'Submitted survey package not found.');
 const {r}=await repo.record(actor,pkg.snapshot.sites[0].recordId,c);
 return{u,pkg,r};
}
export async function customerSendEvidence(repo:any,actor:string,id:string){
 const {r,pkg}=await packageRecord(repo,actor,id);
 const removed=r.data.removedSendingFileIds??[];
 const files=(await repo.pool.query("SELECT id,filename,mime,created_at FROM project_workflow_files WHERE record_id=$1 AND kind='Recommendation sending evidence' ORDER BY created_at",[r.id])).rows.filter((f:any)=>!removed.includes(f.id));
 const rows=(await repo.pool.query('SELECT id,version,stage,data FROM project_workflow_records WHERE id=ANY($1::uuid[])',[pkg.snapshot.sites.map((s:any)=>s.recordId)])).rows;
 return{files,sent:rows.every((r:any)=>r.data.dispatchedAt&&r.data.dispatchVia==='Customer'),versions:rows.map((r:any)=>({id:r.id,version:r.version}))};
}
export async function attachCustomerSendEvidence(repo:any,actor:string,id:string,input:any){
 const {r}=await packageRecord(repo,actor,id);
 if(!['management_review','approved_dispatch'].includes(r.stage))throw new HttpError(409,'Sending evidence is locked after customer dispatch.');
 const saved=await repo.attach(actor,r.id,{...input,kind:'Recommendation sending evidence'});
 await transaction(repo.pool,async(c:any)=>{const current=(await repo.record(actor,r.id,c,true)).r;
 if((current.data.removedSendingFileIds??[]).includes(saved.id))await c.query("UPDATE project_workflow_records SET data=jsonb_set(data,'{removedSendingFileIds}',$2::jsonb),updated_at=now() WHERE id=$1",[r.id,JSON.stringify(current.data.removedSendingFileIds.filter((id:string)=>id!==saved.id))]);});
 return saved;
}
export async function removeCustomerSendEvidence(repo:any,actor:string,id:string,fileId:string){
 return transaction(repo.pool,async(c:any)=>{
  const {pkg}=await packageRecord(repo,actor,id,c);const {r}=await repo.record(actor,pkg.snapshot.sites[0].recordId,c,true);
  const rows=(await c.query('SELECT stage FROM project_workflow_records WHERE id=ANY($1::uuid[])',[pkg.snapshot.sites.map((s:any)=>s.recordId)])).rows;
  if(rows.some((r:any)=>!['management_review','approved_dispatch'].includes(r.stage)))throw new HttpError(409,'Evidence is preserved after customer dispatch.');
  const file=(await c.query("SELECT id,filename FROM project_workflow_files WHERE id=$1 AND record_id=$2 AND kind='Recommendation sending evidence'",[fileId,r.id])).rows[0];if(!file)throw new HttpError(404,'Sending attachment not found.');
  const data={...r.data,removedSendingFileIds:[...new Set([...(r.data.removedSendingFileIds??[]),fileId])]};
  await c.query('UPDATE project_workflow_records SET data=$2,updated_at=now() WHERE id=$1',[r.id,data]);
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`ubl.package.remove-sending-evidence:${id}:${fileId}:${file.filename}`]);return{removed:true};
 });
}
export async function sendPackageToCustomer(repo:any,actor:string,id:string,raw:unknown){
 const v=z.object({requestKey:z.uuid(),confirmed:z.literal(true),recipient:z.string().trim().min(1).max(4000),notes:z.string().trim().min(1).max(4000),versions:z.array(z.object({id:z.uuid(),version:z.number().int().positive()})).min(1).max(50)}).strict().parse(raw);
 return transaction(repo.pool,async(c:any)=>{
  await c.query('SELECT pg_advisory_xact_lock(742019004)');const {pkg}=await packageRecord(repo,actor,id,c);
  const fp=fingerprint({id,...v});const prior=(await c.query('SELECT created_by,input_fingerprint FROM project_workflow_events WHERE request_key=$1',[v.requestKey])).rows[0];
  if(prior){if(prior.created_by!==actor||prior.input_fingerprint!==fp)throw new HttpError(409,'Request key already used.');return{sent:true,repeated:true};}
  const expected=pkg.snapshot.sites.map((s:any)=>s.recordId).sort();if(JSON.stringify(expected)!==JSON.stringify(v.versions.map(r=>r.id).sort()))throw new HttpError(409,'Review the exact complete package.');
  const records=[];for(const recordId of expected){const {r}=await repo.record(actor,recordId,c,true);if(!['management_review','approved_dispatch'].includes(r.stage)||r.data.ublSurveyPackageId!==id||r.version!==v.versions.find(x=>x.id===r.id)?.version)throw new HttpError(409,'A site changed. Refresh before sending.');records.push(r);}
  const first=records.find(r=>r.id===pkg.snapshot.sites[0].recordId);
  const evidence=(await c.query("SELECT * FROM project_workflow_files WHERE record_id=$1 AND kind='Recommendation sending evidence' ORDER BY created_at",[first.id])).rows.filter((f:any)=>!(first.data.removedSendingFileIds??[]).includes(f.id));if(!evidence.length)throw new HttpError(422,'Attach customer sending evidence before submitting.');
  for(const [index,r] of records.entries()){
   if(!r.data.recommendationId)throw new HttpError(422,'A site has no verified recommendation.');
   const fileIds=[];for(const f of evidence){const saved=(await c.query("INSERT INTO project_workflow_files(id,record_id,kind,filename,mime,sha256,content,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(record_id,kind,sha256) DO NOTHING RETURNING id",[randomUUID(),r.id,f.kind,f.filename,f.mime,f.sha256,f.content,actor])).rows[0]??(await c.query('SELECT id FROM project_workflow_files WHERE record_id=$1 AND kind=$2 AND sha256=$3',[r.id,f.kind,f.sha256])).rows[0];fileIds.push(saved.id);}
   const data={...r.data,ublSurveyPackageStatus:'Sent to Customer',ublManagementDecision:{packageId:id,decision:'Approved',notes:v.notes,actor,at:new Date().toISOString()},dispatchVia:'Customer',recipient:v.recipient,salesSendConfirmed:true,dispatchedAt:new Date().toISOString(),customerSendingEvidenceIds:fileIds};
   await repo.document(c,r,actor,'Recommendation dispatch',{packageId:id,recommendationId:r.data.recommendationId,via:'Customer',recipient:v.recipient,evidenceIds:fileIds,customerSent:true,notes:v.notes});
   await c.query("UPDATE project_workflow_records SET stage='customer_tracking',data=$2,version=version+1,updated_at=now() WHERE id=$1",[r.id,data]);
   await c.query('INSERT INTO project_workflow_events(id,record_id,version,action,snapshot,request_key,input_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),r.id,r.version+1,'management-send-ubl-package-to-customer',{stage:'customer_tracking',reason:v.notes,data},index===0?v.requestKey:randomUUID(),fp,actor]);
  }
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`ubl.package.${id}.sent-to-customer:${expected.length}`]);return{sent:true,siteCount:expected.length};
 });
}
