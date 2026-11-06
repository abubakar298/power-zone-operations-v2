import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { transaction } from "../db/transaction.js";
import { HttpError } from "../http/errors.js";
const planSchema=z.object({dispatchId:z.uuid(),recordIds:z.array(z.uuid()).min(1).max(50)}).strict();
const number=(sequence:number)=>`CPZ-SUR-DSP-${String(sequence).padStart(6,"0")}`;
async function requireDesign(c:Pool|PoolClient,actor:string){
 const u=(await c.query("SELECT role FROM users WHERE id=$1 AND active",[actor])).rows[0];
 if(!u||!["Design","Admin","Management"].includes(u.role))throw new HttpError(403,"Design access required.");
}
export async function createDispatch(pool:Pool,actor:string,raw:unknown){
 const input=z.object({requestKey:z.uuid()}).strict().parse(raw);
 return transaction(pool,async c=>{
  await requireDesign(c,actor);
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[input.requestKey]);
  const prior=(await c.query('SELECT * FROM survey_dispatches WHERE creation_key=$1',[input.requestKey])).rows[0];
  if(prior){if(prior.created_by!==actor)throw new HttpError(409,'Dispatch creation key is already in use.');return{id:prior.id,number:number(prior.sequence),closed:!!prior.closed_at};}
  const row=(await c.query('INSERT INTO survey_dispatches(id,creation_key,created_by) VALUES($1,$2,$3) RETURNING *',[randomUUID(),input.requestKey,actor])).rows[0];
  await c.query("INSERT INTO survey_dispatch_events(id,dispatch_id,action,snapshot,created_by) VALUES($1,$2,'created',$3,$4)",[randomUUID(),row.id,{number:number(row.sequence)},actor]);
  return{id:row.id,number:number(row.sequence),closed:false};
 });
}
export async function dispatchChoices(pool:Pool){
 const rows=(await pool.query("SELECT d.id,d.sequence,p.snapshot,(SELECT count(*)::int FROM survey_dispatch_sites s JOIN project_workflow_records r ON r.id=s.record_id WHERE s.dispatch_id=d.id AND (r.data->>'localPreviewArchived') IS DISTINCT FROM 'true') AS site_count FROM survey_dispatches d LEFT JOIN LATERAL (SELECT p.snapshot FROM survey_dispatch_previews p JOIN survey_dispatch_approvals a ON a.preview_id=p.id WHERE p.dispatch_id=d.id ORDER BY a.approved_at DESC LIMIT 1) p ON true WHERE d.closed_at IS NULL AND (d.creation_key IS NOT NULL OR p.snapshot IS NOT NULL) ORDER BY d.sequence DESC LIMIT 100")).rows;
 return rows.map(row=>({id:row.id,number:number(row.sequence),date:row.snapshot?.date??'',siteCount:row.site_count,surveyors:row.snapshot?.surveyors.map((person:any)=>person.display_name).join(', ')??''}));
}
export async function closeDispatch(pool:Pool,actor:string,id:string,raw:unknown){
 const input=z.object({reason:z.string().trim().min(1).max(4000)}).strict().parse(raw);
 return transaction(pool,async c=>{
  await requireDesign(c,actor);
  const row=(await c.query('SELECT * FROM survey_dispatches WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!row)throw new HttpError(404,'Dispatch not found.');
  if(row.closed_at)return{closed:true,repeated:true};
  if((await c.query("SELECT 1 FROM survey_dispatch_sites s JOIN project_workflow_records r ON r.id=s.record_id WHERE s.dispatch_id=$1 AND r.stage IN ('request_review','survey_requested','survey_scheduled') AND (r.data->>'localPreviewArchived') IS DISTINCT FROM 'true'",[id])).rowCount)throw new HttpError(422,'Complete or return all surveys before closing this dispatch.');
  await c.query('UPDATE survey_dispatches SET closed_at=now(),closed_by=$2,closure_reason=$3 WHERE id=$1',[id,actor,input.reason]);
  await c.query("INSERT INTO survey_dispatch_events(id,dispatch_id,action,snapshot,created_by) VALUES($1,$2,'closed',$3,$4)",[randomUUID(),id,{number:number(row.sequence),reason:input.reason},actor]);
  return{closed:true,repeated:false};
 });
}
export async function previewDispatch(pool:Pool,actor:string,raw:unknown){
 const input=planSchema.parse(raw); input.recordIds=[...new Set(input.recordIds)];
 return transaction(pool,async c=>{
  await requireDesign(c,actor);
  const dispatch=(await c.query("SELECT * FROM survey_dispatches WHERE id=$1 FOR SHARE",[input.dispatchId])).rows[0];
  if(!dispatch)throw new HttpError(422,"Create a dispatch or choose an open dispatch first.");
  if(dispatch.closed_at)throw new HttpError(409,"This dispatch is closed. Choose an open dispatch or create a new one.");
  let date='';let team:string[]=[];
  const sites=[];
  for(const id of input.recordIds){
   const row=(await c.query("SELECT r.*,c.name AS customer,c.short_code,c.version AS customer_version,s.name AS site,s.code,s.location,s.contact_person,s.contact_phone,s.version AS site_version FROM project_workflow_records r JOIN customers c ON c.id=r.customer_id JOIN sites s ON s.id=r.site_id WHERE r.id=$1",[id])).rows[0];
   if(!row||row.stage!=="survey_scheduled"||row.data.surveyDispatchId||row.data.surveyInProgress)throw new HttpError(409,"Select scheduled surveys awaiting dispatch, before survey work starts.");
   const siteDate=z.iso.date().parse(row.data.scheduledSurveyDate);
   const siteTeam=[...new Set<string>(z.array(z.uuid()).min(1).max(20).parse(row.data.surveyTeam))].sort();
   if(date&&(date!==siteDate||JSON.stringify(team)!==JSON.stringify(siteTeam)))throw new HttpError(422,"Sites in one dispatch must have the same saved survey date and surveyors. Adjust their schedules separately first.");
   date=siteDate;team=siteTeam;
   sites.push({recordId:id,version:row.version,customerId:row.customer_id,siteId:row.site_id,customerVersion:row.customer_version,siteVersion:row.site_version,customer:row.customer,customerCode:row.short_code,site:row.site,code:row.code,address:row.location,contact:row.contact_person,phone:row.contact_phone,notes:row.data.notes??""});
  }
  const surveyors=[];
  for(const id of team){
   const person=(await c.query("SELECT id,display_name,'' AS phone FROM users WHERE id=$1 AND active AND role='Design' UNION ALL SELECT id,display_name,phone FROM survey_team_members WHERE id=$1 AND active",[id])).rows[0];
   if(!person)throw new HttpError(422,"A scheduled surveyor is no longer active. Update the schedule first.");surveyors.push(person);
  }
  const existing=(await c.query("SELECT p.snapshot FROM survey_dispatch_previews p JOIN survey_dispatch_approvals a ON a.preview_id=p.id WHERE p.dispatch_id=$1 ORDER BY a.approved_at DESC LIMIT 1",[dispatch.id])).rows[0]?.snapshot;
  if(existing&&(existing.date!==date||JSON.stringify([...existing.team].sort())!==JSON.stringify([...team].sort())))throw new HttpError(422,"This dispatch already has a different date or surveyors. Use its existing date/team or create a new dispatch.");
  const snapshot={dispatchId:dispatch.id,number:number(dispatch.sequence),date,team,surveyors,sites:[...(existing?.sites??[]),...sites],newRecordIds:input.recordIds};
  const previewId=randomUUID();await c.query("INSERT INTO survey_dispatch_previews(id,dispatch_id,snapshot,created_by) VALUES($1,$2,$3,$4)",[previewId,dispatch.id,snapshot,actor]);
  return {id:previewId,...snapshot,approved:false};
 });
}
export async function getDispatchPreview(pool:Pool,actor:string,id:string){
 await requireDesign(pool,actor);
 const row=(await pool.query("SELECT p.*,a.approved_at,d.closed_at,EXISTS(SELECT 1 FROM survey_dispatch_sites s JOIN project_workflow_records r ON r.id=s.record_id WHERE s.dispatch_id=d.id AND r.stage IN ('request_review','survey_requested','survey_scheduled') AND (r.data->>'localPreviewArchived') IS DISTINCT FROM 'true') AS pending_surveys FROM survey_dispatch_previews p JOIN survey_dispatches d ON d.id=p.dispatch_id LEFT JOIN survey_dispatch_approvals a ON a.preview_id=p.id WHERE p.id=$1",[id])).rows[0];
 if(!row)throw new HttpError(404,"Survey dispatch preview not found.");
 return{id:row.id,...row.snapshot,approved:!!row.approved_at,approvedAt:row.approved_at,closed:!!row.closed_at,canClose:!!row.approved_at&&!row.closed_at&&!row.pending_surveys};
}
export async function latestDispatch(pool:Pool,actor:string,id:string){
 await requireDesign(pool,actor);
 const row=(await pool.query("SELECT p.id FROM survey_dispatch_previews p JOIN survey_dispatch_approvals a ON a.preview_id=p.id WHERE p.dispatch_id=$1 ORDER BY a.approved_at DESC LIMIT 1",[id])).rows[0];
 if(!row)throw new HttpError(404,"This dispatch has not been approved and scheduled.");return getDispatchPreview(pool,actor,row.id);
}
export async function approveDispatch(pool:Pool,actor:string,id:string){
 return transaction(pool,async c=>{
  await requireDesign(c,actor);
  const p=(await c.query("SELECT * FROM survey_dispatch_previews WHERE id=$1",[id])).rows[0];
  if(!p)throw new HttpError(404,"Review the dispatch preview first.");
  const dispatch=(await c.query("SELECT * FROM survey_dispatches WHERE id=$1 FOR UPDATE",[p.dispatch_id])).rows[0];
  if(dispatch.closed_at)throw new HttpError(409,"This dispatch is closed. Review an open dispatch instead.");
  if((await c.query("SELECT 1 FROM survey_dispatch_approvals WHERE preview_id=$1",[id])).rowCount)return{dispatchId:p.dispatch_id,number:p.snapshot.number,repeated:true};
  const approved=(await c.query("SELECT p.snapshot FROM survey_dispatch_previews p JOIN survey_dispatch_approvals a ON a.preview_id=p.id WHERE p.dispatch_id=$1 ORDER BY a.approved_at DESC LIMIT 1",[p.dispatch_id])).rows[0]?.snapshot;
  if(approved&&JSON.stringify(approved.sites.map((s:any)=>s.recordId).sort())!==JSON.stringify(p.snapshot.sites.filter((s:any)=>!p.snapshot.newRecordIds.includes(s.recordId)).map((s:any)=>s.recordId).sort()))throw new HttpError(409,"Dispatch contents changed. Review a fresh preview.");
  for(const site of [...p.snapshot.sites].filter((s:any)=>p.snapshot.newRecordIds.includes(s.recordId)).sort((a:any,b:any)=>a.recordId.localeCompare(b.recordId))){
   const r=(await c.query("SELECT * FROM project_workflow_records WHERE id=$1 FOR UPDATE",[site.recordId])).rows[0];
   const versions=(await c.query("SELECT c.version AS cv,s.version AS sv FROM customers c JOIN sites s ON s.customer_id=c.id WHERE c.id=$1 AND s.id=$2 FOR SHARE OF c,s",[site.customerId,site.siteId])).rows[0];
   if(r?.stage!=="survey_scheduled"||r.data.surveyDispatchId||r.data.surveyInProgress||r.version!==site.version||versions?.cv!==site.customerVersion||versions?.sv!==site.siteVersion)throw new HttpError(409,`Request or master details changed for ${site.site}. Review a fresh preview.`);
   const data={...r.data,surveyDispatchId:p.dispatch_id,surveyDispatchNumber:p.snapshot.number};
   await c.query("INSERT INTO survey_dispatch_sites(record_id,dispatch_id) VALUES($1,$2)",[r.id,p.dispatch_id]);
   await c.query("UPDATE project_workflow_records SET data=$2,version=version+1,updated_at=now() WHERE id=$1",[r.id,data]);
   for(const kind of ['Survey dispatch','Survey form']){
    const version=(await c.query("SELECT COALESCE(max(version),0)+1 AS v FROM project_workflow_documents WHERE record_id=$1 AND kind=$2",[r.id,kind])).rows[0].v;
    await c.query("INSERT INTO project_workflow_documents(id,record_id,kind,version,number,snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",[randomUUID(),r.id,kind,version,`${p.snapshot.number}-${kind==='Survey form'?'FORM':'ORDER'}-${r.id.slice(0,8)}-V${version}`,{...p.snapshot,approved:true,siteRecordId:r.id,dispatchPreviewId:id},actor]);
   }
   await c.query("INSERT INTO project_workflow_events(id,record_id,version,action,snapshot,request_key,input_fingerprint,created_by) VALUES($1,$2,$3,'assign-dispatch',$4,$5,$6,$7)",[randomUUID(),r.id,r.version+1,{stage:'survey_scheduled',reason:`Assigned approved survey dispatch ${p.snapshot.number}; saved survey schedule retained`,data},randomUUID(),id,actor]);
  }
  await c.query("INSERT INTO survey_dispatch_approvals(preview_id,approved_by) VALUES($1,$2)",[id,actor]);
  await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)",[actor,`survey.dispatch.${p.snapshot.number}.approved-and-assigned`]);
  return{dispatchId:p.dispatch_id,number:p.snapshot.number,repeated:false};
 });
}
