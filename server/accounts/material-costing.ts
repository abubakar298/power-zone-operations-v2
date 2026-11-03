import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {z} from 'zod';
import {AccountsRepository} from './repository.js';
import {customerDocuments} from './customer-documents.js';
import {InventoryRepository} from '../inventory/repository.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';

/** One pending task per exact job, never a join by a shared PO or site name. */
export async function materialCostingQueue(pool:Pool,actor:string){
 await new AccountsRepository(pool).access(actor);
 const [documents,reports,closures,entries,jobEntries]=await Promise.all([
  customerDocuments(pool),new InventoryRepository(pool).list(actor),
  pool.query('SELECT DISTINCT ON(job_key) job_key,stage FROM accounts_active_job_closures ORDER BY job_key,version DESC'),
  pool.query("SELECT source_id,source_version,pt_reference FROM accounts_pt_entries WHERE source_kind='Inventory'"),
  pool.query('SELECT job_key FROM accounts_job_pt_entries')
 ]);
 return {rows:projectMaterialCostingQueue(documents.rows,reports,closures.rows,entries.rows,jobEntries.rows),stockPosting:false};
}
export function projectMaterialCostingQueue(documents:any[],reports:any[],closures:any[],entries:any[],jobEntries:any[]=[]){
 // A job marked as recorded in PT leaves this queue even before Inventory reconciles.
 const finished=new Set([...closures.filter(r=>['Closed','Awaiting Management'].includes(r.stage)).map(r=>r.job_key),...jobEntries.map(r=>r.job_key)]);
 const rows=new Map<string,any>();
 for(const r of reports.filter(r=>r.stage==='Sent to Accounts')){
  if(finished.has(r.job_key)||entries.some(p=>p.source_id===r.id&&p.source_version===r.version))continue;
  rows.set(r.job_key,{key:r.job_key,jobKey:r.job_key,siteName:r.site_name,ipo:r.job_id,customer:r.customer_code??'',receivedAt:r.created_at,report:r,documents:[],status:'Ready for PT entry'});
 }
 for(const d of documents){
  if(d.jobKey&&finished.has(d.jobKey)||finished.has('site:'+d.siteId))continue;
  const report=reports.find(r=>r.job_key===d.jobKey&&r.stage==='Sent to Accounts');
  if(report&&entries.some(p=>p.source_id===report.id&&p.source_version===report.version))continue;
  const key=d.jobKey??d.siteId;
  if(!rows.has(key))rows.set(key,{key,jobKey:d.jobKey,siteName:d.siteName,ipo:d.ipo,customer:d.customer,receivedAt:d.receivedAt,report:null,documents:[],status:'Awaiting QC usage'});
  const row=rows.get(key);if(!row.customer)row.customer=d.customer;row.siteId=d.siteId;row.documents.push(d);if(d.receivedAt>row.receivedAt)row.receivedAt=d.receivedAt;
 }
 return [...rows.values()].sort((a,b)=>String(b.receivedAt).localeCompare(String(a.receivedAt))||a.key.localeCompare(b.key));
}

export const jobPtEntrySchema=z.object({jobKey:z.string().trim().min(1).max(200),ptReference:z.string().trim().min(1).max(200),entryDate:z.iso.date(),notes:z.string().trim().max(2000).default(''),requestKey:z.uuid()}).strict();
/** Salaas enters the costs in Peachtree, then marks the job recorded here. Where the
 * current Inventory reconciliation is with Accounts, its PT entry is saved too, so
 * Job Closure accepts it exactly as before. QC evidence alone never marks PT. */
export async function markJobRecordedInPt(pool:Pool,actor:string,raw:unknown,now=new Date()){
 const input=jobPtEntrySchema.parse(raw),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(input.entryDate>today)throw new HttpError(422,'PT entry date cannot be in the future.');
 const queue=await materialCostingQueue(pool,actor);
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);
  if(!['Admin','Accounts'].includes(await new AccountsRepository(pool).access(actor,c)))throw new HttpError(403,'Accounts PT entry access required.');
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['closure:'+input.jobKey]);
  const replay=(await c.query('SELECT *,entry_date::text AS entry_date FROM accounts_job_pt_entries WHERE request_key=$1',[input.requestKey])).rows[0];
  if(replay){if(replay.created_by===actor&&Object.entries(input).every(([k,v])=>replay.request[k]===v))return replay;throw new HttpError(409,'Request key already used.');}
  if((await c.query('SELECT 1 FROM accounts_job_pt_entries WHERE job_key=$1',[input.jobKey])).rowCount)throw new HttpError(409,'This job is already marked as recorded in PT.');
  const row=queue.rows.find(r=>r.key===input.jobKey);
  if(!row)throw new HttpError(409,'This job is no longer pending Material Costing & PT Entry. Refresh the queue.');
  // Use the reconciliation current at save time; a changed version needs a fresh review.
  const report=row.report?(await c.query("SELECT v.id,v.version,v.stage FROM inventory_report_versions v WHERE v.report_id=$1 ORDER BY v.version DESC LIMIT 1",[row.report.id])).rows[0]:undefined;
  if(row.report&&(report?.version!==row.report.version||report.stage!=='Sent to Accounts'))throw new HttpError(409,'Inventory changed this reconciliation. Reopen the material usage before marking PT.');
  const jobKey=row.jobKey??'site:'+row.siteId;
  if(jobKey!==input.jobKey&&(await c.query('SELECT 1 FROM accounts_job_pt_entries WHERE job_key=$1',[jobKey])).rowCount)throw new HttpError(409,'This job is already marked as recorded in PT.');
  const snapshot={siteId:row.siteId??null,siteName:row.siteName,ipo:row.ipo,customer:row.customer,reportId:row.report?.id??null,reportVersion:row.report?.version??null,documents:row.documents.map((d:any)=>({id:d.id,kind:d.kind,filename:d.filename}))};
  const saved=(await c.query('INSERT INTO accounts_job_pt_entries(id,job_key,site_id,report_version_id,pt_reference,entry_date,notes,snapshot,request,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *,entry_date::text AS entry_date',[randomUUID(),jobKey,row.siteId??null,report?.id??null,input.ptReference,input.entryDate,input.notes,snapshot,input,input.requestKey,actor])).rows[0];
  if(report)await c.query('INSERT INTO accounts_pt_entries(id,source_kind,source_id,source_version,pt_reference,entry_date,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(source_kind,source_id,source_version) DO NOTHING',[randomUUID(),'Inventory',row.report.id,report.version,input.ptReference,input.entryDate,input.notes,actor]);
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'accounts.job-pt-entry:'+saved.id]);
  return saved;
 });
}
