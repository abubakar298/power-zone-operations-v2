import type {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {HttpError} from '../http/errors.js';
import {transaction} from '../db/transaction.js';
import {fingerprint} from '../boq/repository.js';
export function remainingDays(target:string,today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Karachi'})){
 return Math.ceil((Date.parse(target+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000);
}
export class ProjectCheckpointsRepository{
 constructor(private pool:Pool){}
 async access(actor:string,department?:string){
  const u=(await this.pool.query('SELECT role,active FROM users WHERE id=$1',[actor])).rows[0];
  if(!u?.active)throw new HttpError(401,'Your access has ended.');
  if(!['Admin','Management','Operations','Accounts'].includes(u.role)||department&& !['Admin','Management',department].includes(u.role))throw new HttpError(403,'This checkpoint is restricted to its department.');
  return u.role;
 }
 async list(actor:string){
  const role=await this.access(actor);
  const rows=(await this.pool.query(`SELECT 'ubl:'||o.site_id AS key,'CHP-'||o.legacy_ipo_number AS job_id,o.site_name,o.configuration_id,o.status,o.baseline->>'sellingIncludingGst' AS agreed_total,l.snapshot AS imported FROM ubl_effective_site_orders o LEFT JOIN project_source_links l ON l.job_key='ubl:'||o.site_id ORDER BY o.source_row`)).rows;
  const regular=(await this.pool.query(`SELECT 'ipo:'||id AS key,CASE WHEN number ~ '^CPZ-IPO-[0-9]{2}-[0-9]+' THEN 'CHP-'||split_part(number,'-',4) ELSE number END AS job_id,snapshot->>'siteName' AS site_name,snapshot->>'solutionId' AS configuration_id,'Active' AS status FROM internal_purchase_orders ORDER BY created_at DESC LIMIT 500`)).rows;
  const versions=(await this.pool.query('SELECT DISTINCT ON(job_key,department) job_key,department,version,snapshot,created_at FROM project_checkpoint_versions ORDER BY job_key,department,version DESC')).rows;
  return [...rows,...regular].map(r=>{
   const imported=r.imported,source=imported?.site;
   const ops=versions.find(v=>v.job_key===r.key&&v.department==='Operations');
   const accounts=versions.find(v=>v.job_key===r.key&&v.department==='Accounts');
   const defaults={solarDelivery:source?.solar_structure_delivery_date??'',startDate:source?.project_start_date??'',equipmentDelivery:source?.other_items_delivery_date??'',completionDate:source?.completion_date??'',installationStatus:r.status==='Cancelled'?'Cancelled':source?.completion_status==='Completed'?'Installation completed':source?'Work in Progress':'Awaiting data',estimatedDate:r.status!=='Cancelled'&&source?.completion_status!=='Completed'&&source?'2026-10-14':'',remarks:r.job_id==='CHP-286'?'Malir batteries added; previous shortage resolved.':source?.operational_notes??'',evidence:''};
   const operation={...defaults,...ops?.snapshot};
   const flags:string[]=[];
   if(r.status==='Cancelled'){operation.installationStatus='Cancelled';operation.estimatedDate='';flags.push('PO cancelled — retained for history');}
   if(['CHP-292','CHP-316'].includes(r.job_id))flags.push('20 kW inverter installed due to stock shortage — replacement required');
   if(r.job_id==='CHP-288')flags.push('Approved 20-20-30; installed 25-20-30 — review actual variance');
   if(r.status!=='Active'&&r.status!=='Cancelled')flags.push('PO revision pending');
   const invoices=imported?.invoices??[],payments=imported?.payments??[];
   const recorded=invoices.filter((i:any)=>i.invoice_type!=='Internet (11 months)'&&i.recorded_invoice_total!=null);
   const invoiceTotal=recorded.length?recorded.reduce((n:Decimal,i:any)=>n.add(i.recorded_invoice_total),new Decimal(0)):null;
   const difference=invoiceTotal&&r.agreed_total!=null?invoiceTotal.sub(r.agreed_total).toFixed(2):null;
   if(difference&&new Decimal(difference).abs().gt('0.01'))flags.push('Invoice difference — review required; approved price unchanged');
   if(invoices.some((i:any)=>i.invoice_type==='Additional - unclassified'))flags.push('Additional invoice — reconcile against actual IRR');
   const result:any={key:r.key,jobId:r.job_id,siteName:(r.site_name??'').replace(/^UBL\s+/i,''),configuration:r.configuration_id,status:r.status,operation,operationsVersion:ops?.version??0,remainingDays:operation.estimatedDate?remainingDays(operation.estimatedDate):null,flags,sourceAvailable:!!source};
   if(role!=='Operations')Object.assign(result,{agreedTotal:r.agreed_total??null,invoiceTotal:invoiceTotal?.toFixed(2)??null,difference,invoices,payments,accountsVersion:accounts?.version??0,accounts:{remarks:'',evidence:'',adjustmentStatus:'Awaiting IRR review',...accounts?.snapshot},sourceSummary:source?{recordedTotal:source.recorded_total,received:source.received_amount,outstanding:source.outstanding_amount,balanceSubmission:source.balance_submission,advanceReceipt:source.advance_receipt_status}:null,sourceHistory:imported?.history??[]});
   return result;
  });
 }
 async save(actor:string,key:string,input:{department:string;version:number;requestKey:string;snapshot:Record<string,string>}){
  await this.access(actor,input.department);
  const jobs=await this.list(actor),job=jobs.find(j=>j.key===key);
  if(!job)throw new HttpError(404,'Job not found.');
  if(job.status==='Cancelled')throw new HttpError(409,'Cancelled PO checkpoints are read-only.');
  if(input.department==='Operations'){
   const s=input.snapshot;
   if(s.installationStatus==='Installation completed'&&!s.completionDate)throw new HttpError(400,'Enter the installation completion date.');
   if(s.startDate&&s.completionDate&&s.completionDate<s.startDate)throw new HttpError(400,'Completion cannot be before installation started.');
   if(s.solarDelivery&&s.equipmentDelivery&&s.equipmentDelivery<s.solarDelivery)throw new HttpError(400,'Equipment delivery cannot precede panels delivery.');
  }
  return transaction(this.pool,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key+':'+input.department]);
   const replay=(await c.query('SELECT * FROM project_checkpoint_versions WHERE request_key=$1',[input.requestKey])).rows[0];
   if(replay){if(replay.job_key!==key||replay.department!==input.department||replay.created_by!==actor||fingerprint(replay.snapshot)!==fingerprint(input.snapshot))throw new HttpError(409,'This request belongs to different inputs.');return replay;}
   const latest=Number((await c.query('SELECT COALESCE(max(version),0) AS v FROM project_checkpoint_versions WHERE job_key=$1 AND department=$2',[key,input.department])).rows[0].v);
   if(latest!==input.version)throw new HttpError(409,'Checkpoints changed. Reload before saving.');
   const row=(await c.query('INSERT INTO project_checkpoint_versions(id,job_key,department,version,snapshot,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[randomUUID(),key,input.department,latest+1,input.snapshot,input.requestKey,actor])).rows[0];
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'project.checkpoints.'+input.department+':'+key+':v'+(latest+1)]);return row;
  });
 }
}
