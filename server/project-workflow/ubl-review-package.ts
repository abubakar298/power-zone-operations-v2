import {randomUUID} from 'node:crypto';import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {z} from 'zod';import {jsPDF} from 'jspdf';import {autoTable} from 'jspdf-autotable';import {transaction} from '../db/transaction.js';import {fingerprint} from '../boq/repository.js';import {HttpError} from '../http/errors.js';
const execute=promisify(execFile);
const keys=['gensetKva','loadShedding','roofSpace','phase','runningLoad','connectedLoad','wapda','atm','acQty','internalWiring','roofType','property','mainDb','obstacles','itSpace','wifi','recommendation','clientRemarks'];
const source=(r:any)=>fingerprint({survey:r.data.surveyInputs,forms:r.data.customerSurveyForms,framework:r.framework_id,verified:r.data.technicalVerifiedAt});
export async function submissionGroups(repo:any,actor:string){
 const user=await repo.user(actor);repo.requireRole(user,['Coordinator']);
 const rows=(await repo.pool.query(`SELECT g.id,g.sequence,g.created_at,jsonb_agg(jsonb_build_object('recordId',r.id,'siteName',r.site_name,'siteCode',COALESCE(s.code,r.site_code)) ORDER BY m.joined_at,r.id) AS sites FROM survey_submission_groups g JOIN survey_submission_group_members m ON m.group_id=g.id JOIN project_workflow_records r ON r.id=m.record_id LEFT JOIN sites s ON s.id=r.site_id WHERE r.data->>'localPreviewArchived' IS DISTINCT FROM 'true' AND g.status='Open' AND ($2 OR g.created_by=$1) GROUP BY g.id ORDER BY g.sequence`,[actor,['Admin','Management'].includes(user.role)])).rows;
 return rows.map((g:any)=>({...g,number:`SSG-${String(g.sequence).padStart(5,'0')}`,siteCount:g.sites.length}));
}
export async function submissionGroupFile(repo:any,actor:string,id:string){
 const groups=await submissionGroups(repo,actor);if(!groups.some((g:any)=>g.id===id))throw new HttpError(404,'Survey submission group not found.');
 const rows=(await repo.pool.query(`SELECT m.record_id,p.snapshot FROM survey_submission_group_members m JOIN ubl_survey_review_packages p ON p.id=m.saved_package_id WHERE m.group_id=$1 ORDER BY m.joined_at,m.record_id`,[id])).rows;
 const sites=rows.map((r:any)=>r.snapshot.sites.find((s:any)=>s.recordId===r.record_id));
 if(!sites.length||sites.some((s:any)=>!s))throw new HttpError(409,'The group is not ready for download. Refresh its list.');
 return{content:await exportExcel({sites}),mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',name:'UBL-Survey-Submission-Group.xlsx'};
}
export async function unbindSubmissionGroup(repo:any,actor:string,id:string,raw:unknown){
 const input=z.object({groupId:z.uuid(),version:z.number().int().positive(),confirmed:z.literal(true)}).strict().parse(raw);
 return transaction(repo.pool,async(c:any)=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['survey-submission-groups']);
  const {u,r}=await repo.record(actor,id,c,true);repo.requireRole(u,['Coordinator']);
  const group=(await c.query("SELECT g.* FROM survey_submission_groups g JOIN survey_submission_group_members m ON m.group_id=g.id WHERE m.record_id=$1 AND g.status='Open'",[id])).rows[0];
  if(!group||group.id!==input.groupId||r.version!==input.version)throw new HttpError(409,'The site or group changed. Refresh before removing it.');
  if(group.created_by!==actor&&!['Admin','Management'].includes(u.role))throw new HttpError(403,'Only the responsible coordinator can change this group.');
  const data={...r.data,surveySubmissionGroupId:null,ublSurveyPackageStatus:'Removed from group'};
  await c.query('DELETE FROM survey_submission_group_members WHERE record_id=$1',[id]);
  await c.query('UPDATE project_workflow_records SET data=$2,version=version+1,updated_at=now() WHERE id=$1',[id,data]);
  await c.query('INSERT INTO project_workflow_events(id,record_id,version,action,snapshot,request_key,input_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),id,r.version+1,'remove-from-survey-submission-group',{stage:r.stage,reason:'Coordinator confirmed removal from survey submission group; site unlocked for review.',data},randomUUID(),fingerprint(input),actor]);
  return{id,removed:true};
 });
}
export async function packageList(repo:any,actor:string){const user=await repo.user(actor);repo.requireRole(user,['Coordinator']);return(await repo.pool.query("SELECT p.id,p.status,p.created_at,p.snapshot FROM ubl_survey_review_packages p WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(p.snapshot->'sites') s JOIN project_workflow_records r ON r.id::text=s->>'recordId' WHERE r.data->>'localPreviewArchived' IS DISTINCT FROM 'true') AND ($2 OR p.created_by=$1) ORDER BY created_at DESC LIMIT 100",[actor,['Management','Admin'].includes(user.role)])).rows;}
export async function exportExcel(snapshot:any){const directory=await mkdtemp(join(tmpdir(),'pz-ubl-survey-'));try{const output=join(directory,'UBL-Surveys.xlsx'),input=join(directory,'input.json');await writeFile(input,JSON.stringify({template:resolve('assets/ubl-survey-template.xlsx'),rows:snapshot.sites.map((site:any,index:number)=>[index+1,...site.excelRow.slice(1)]),surveyors:[...new Set(snapshot.sites.map((s:any)=>s.surveyors).filter(Boolean))].join('; '),output}));try{await execute(process.execPath,['scripts/ubl-survey-xlsx.mjs',input],{timeout:120000,maxBuffer:1000000});}catch{throw new HttpError(503,'UBL Excel export could not run. The local spreadsheet runtime must be available. No submission was saved.');}return await readFile(output);}finally{await rm(directory,{recursive:true,force:true});}}
export function exportSummary(snapshot:any){const doc=new jsPDF();doc.setFontSize(16);doc.text('UBL Survey Review Summary',14,18);doc.setFontSize(10);doc.text(`${snapshot.sites.length} site(s) | ${snapshot.remarks||'Technical survey review'}`,14,26,{maxWidth:180});for(const site of snapshot.sites){doc.addPage();doc.setFontSize(13);doc.text(`${site.siteCode} | ${site.siteName}`,14,18,{maxWidth:180});doc.setFontSize(10);doc.text(site.summary.remarks||'No technical remarks recorded',14,30,{maxWidth:180});const rows=[...site.summary.panels,...site.summary.cableRows].map((r:any)=>[r.field,r.approved,r.entered,r.status??(r.different?'Changed':'Matches')]);autoTable(doc,{startY:52,head:[['Requirement','Standard','Survey','Difference']],body:rows,styles:{fontSize:9},margin:{left:14,right:14}});}return Buffer.from(doc.output('arraybuffer'));}
export async function savePackage(repo:any,actor:string,raw:unknown){
 const input=z.object({requestKey:z.uuid(),recordIds:z.array(z.uuid()).min(1).max(50),groupId:z.uuid().optional(),submit:z.boolean(),remarks:z.string().trim().max(4000).default('')}).strict().parse(raw);
 input.recordIds=[...new Set(input.recordIds)];const user=await repo.user(actor);repo.requireRole(user,['Coordinator']);
 const repeat=(row:any)=>{if(row.snapshot.inputFingerprint!==fingerprint(input)||row.snapshot.owner!==actor)throw new HttpError(409,'Request key already used for another package.');return{id:row.id,status:row.status,repeated:true};};
 const prior=(await repo.pool.query('SELECT id,status,snapshot FROM ubl_survey_review_packages WHERE request_key=$1',[input.requestKey])).rows[0];if(prior)return repeat(prior);
 const sites:any[]=[];
 for(const id of input.recordIds){
  const {r}=await repo.record(actor,id);
  if(r.short_code!=='UBL'||r.route!=='survey-framework'||r.stage!=='design_handed_off'||!r.data.technicalVerifiedAt||r.data.noFeasibleSolution)throw new HttpError(422,'Select technically reviewed UBL surveys still awaiting Coordination action.');
  const form=r.data.customerSurveyForms?.['ubl-solar-survey']?.values;
  if(!form||keys.some(key=>String(form[key]??'').trim()===''))throw new HttpError(422,`${r.site_name}: complete the saved UBL survey details first.`);
  const summary=await repo.preview(actor,id,{kind:'technical-summary'});
  sites.push({recordId:id,siteName:r.site_name,siteCode:r.canonical_site_code??r.site_code,sourceFingerprint:source(r),summary,excelRow:[0,r.canonical_site_code??r.site_code,r.site_name,'PZES',...keys.map(key=>form[key])]});
 }
 const snapshot={owner:actor,inputFingerprint:fingerprint(input),remarks:input.remarks,sites};
 const xlsx=input.submit?await exportExcel(snapshot):null,pdf=input.submit?exportSummary(snapshot):null;
 return transaction(repo.pool,async(c:any)=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['survey-submission-groups']);
  const repeated=(await c.query('SELECT id,status,snapshot FROM ubl_survey_review_packages WHERE request_key=$1',[input.requestKey])).rows[0];if(repeated)return repeat(repeated);
  let group:any;
  if(input.groupId){
   group=(await c.query('SELECT * FROM survey_submission_groups WHERE id=$1 FOR UPDATE',[input.groupId])).rows[0];
   if(!group||group.status!=='Open'||group.created_by!==actor&&!['Admin','Management'].includes(user.role))throw new HttpError(409,'This survey submission group is unavailable. Refresh the list.');
   const members=(await c.query('SELECT record_id FROM survey_submission_group_members WHERE group_id=$1 ORDER BY record_id',[group.id])).rows.map((m:any)=>m.record_id);
   if(!input.submit||JSON.stringify(members)!==JSON.stringify([...input.recordIds].sort()))throw new HttpError(409,'The group contents changed. Refresh before sending.');
  }else if(!input.submit){
   group=(await c.query("SELECT * FROM survey_submission_groups WHERE created_by=$1 AND status='Open' FOR UPDATE",[actor])).rows[0];
   if(!group)group=(await c.query('INSERT INTO survey_submission_groups(created_by) VALUES($1) RETURNING *',[actor])).rows[0];
  }
  const records=[];
  for(const site of [...sites].sort((a,b)=>a.recordId.localeCompare(b.recordId))){
   const {r}=await repo.record(actor,site.recordId,c,true);
   if(r.stage!=='design_handed_off'||source(r)!==site.sourceFingerprint)throw new HttpError(409,'A selected survey changed. Reload and review before saving or sending.');
   const membership=(await c.query('SELECT group_id FROM survey_submission_group_members WHERE record_id=$1',[r.id])).rows[0];
   if(membership&&membership.group_id!==input.groupId)throw new HttpError(409,'This survey is locked in a submission group. Remove it from the group before reviewing or sending individually.');
   records.push(r);
  }
  const packageId=randomUUID(),status=input.submit?'Submitted for Management':'Saved for combining';
  await c.query('INSERT INTO ubl_survey_review_packages(id,request_key,created_by,status,snapshot,xlsx,report_pdf) VALUES($1,$2,$3,$4,$5,$6,$7)',[packageId,input.requestKey,actor,status,snapshot,xlsx,pdf]);
  for(const r of records){
   const data={...r.data,ublSurveyPackageId:packageId,ublSurveyPackageStatus:status,surveySubmissionGroupId:input.submit?null:group.id};
   const stage=input.submit?'management_review':r.stage;
   await c.query('UPDATE project_workflow_records SET data=$2,stage=$3,version=version+1,updated_at=now() WHERE id=$1',[r.id,data,stage]);
   if(!input.submit)await c.query('INSERT INTO survey_submission_group_members(record_id,group_id,saved_package_id) VALUES($1,$2,$3)',[r.id,group.id,packageId]);
   await c.query('INSERT INTO project_workflow_events(id,record_id,version,action,snapshot,request_key,input_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),r.id,r.version+1,input.submit?'submit-ubl-survey-package':'save-ubl-survey-package',{stage,reason:status+' — report and UBL Excel information retained together.',data},randomUUID(),fingerprint({packageId,recordId:r.id}),actor]);
  }
  if(input.submit&&group){await c.query("UPDATE survey_submission_groups SET status='Submitted',package_id=$2,submitted_at=now() WHERE id=$1",[group.id,packageId]);await c.query('DELETE FROM survey_submission_group_members WHERE group_id=$1',[group.id]);}
  return{id:packageId,status,siteCount:sites.length,groupId:group?.id};
 });
}
export async function packageFile(repo:any,actor:string,id:string,kind:string){const user=await repo.user(actor);repo.requireRole(user,['Coordinator']);const row=(await repo.pool.query('SELECT * FROM ubl_survey_review_packages WHERE id=$1',[id])).rows[0];if(!row||row.created_by!==actor&&!['Admin','Management'].includes(user.role))throw new HttpError(404,'Package not found.');if(kind==='xlsx')return{content:row.xlsx??await exportExcel(row.snapshot),mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',name:'UBL-Survey-Review.xlsx'};return{content:row.report_pdf??exportSummary(row.snapshot),mime:'application/pdf',name:'UBL-Survey-Summary.pdf'};}
