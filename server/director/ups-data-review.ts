import type {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {Decimal} from 'decimal.js';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';

const date=z.iso.date().nullable(),amount=z.string().trim().regex(/^(?:\d+(?:\.\d{1,2})?)?$/).max(24);
export const upsReviewValues=z.object({siteName:z.string().trim().max(1000),deliveryStatus:z.enum(['Delivered','Not delivered','Unverified']),installationStatus:z.enum(['Completed','Pending','Unverified','Review needed']),deliveryDate:date,installationDate:date,ipoSharedDate:date,invoiceReference:z.string().trim().max(200),invoiceAmount:amount,invoiceStatus:z.enum(['Submitted','Not submitted','Unverified']),invoiceSubmittedDate:date,paymentStatus:z.enum(['Received','Pending','Unverified']),paymentReceivedDate:date,paymentReceivedAmount:amount,delayOwner:z.enum(['UBL','MBL','PZ','Unclassified'])}).strict();
const inputSchema=z.object({programKey:z.string().regex(/^UPS:(?:UBL|MBL):CHP-\d+$/),expectedVersion:z.number().int().positive(),orderNumber:z.string().regex(/^\d+\/\d+$/),values:upsReviewValues,notes:z.string().trim().min(1).max(1000)}).strict();
const isoDate=(value:any)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}/.test(value)?value.slice(0,10):null;
const unique=(values:any[])=>{const found=[...new Set(values.filter(Boolean))];return found.length===1?found[0]:null;};
const positive=(value:string)=>value!==''&&new Decimal(value).gt(0);
export function reviewValues(register:any,site:any){
 const status=site.recoveryStatus??{},alert=register.installationAlerts?.[site.orderNumber],confirmation=register.completionConfirmations?.[site.orderNumber];
 if(status.dataReview?.values)return status.dataReview.values;
 const invoices=status.systemInvoices??[],invoice=invoices.length===1?invoices[0]:null,evidence=(status.recoveryEvidence??[]).filter((e:any)=>!invoice||e.invoice===invoice.invoice);
 return {siteName:site.siteName||alert?.evidenceSiteName||'',deliveryStatus:status.deliveryStatus??'Unverified',installationStatus:confirmation?'Completed':status.installationStatus??'Unverified',deliveryDate:isoDate(alert?.deliveryDate??status.deliveryDate)??unique(evidence.map((e:any)=>isoDate(e.delivery))),installationDate:isoDate(confirmation?.completionDate)??(status.installationStatus==='Completed'?unique(evidence.map((e:any)=>isoDate(e.install))):null),ipoSharedDate:isoDate(site.ipoSharedAt),invoiceReference:invoice?.invoice??site.invoiceReference??'',invoiceAmount:invoice?.amount??'',invoiceStatus:['Submitted','Not submitted'].includes(status.invoiceStatus)?status.invoiceStatus:'Unverified',invoiceSubmittedDate:unique(evidence.map((e:any)=>isoDate(e.submit))),paymentStatus:status.systemPaymentStatus??status.paymentStatus??'Unverified',paymentReceivedDate:isoDate(status.paymentReceivedDate),paymentReceivedAmount:status.paymentReceivedAmount??(invoice?.paymentReceived?invoice.amount:''),delayOwner:status.delayOwner??alert?.delayOwner??'Unclassified'};
}
export function missingReviewFields(v:z.infer<typeof upsReviewValues>){
 const fields:string[]=[];
 if(!v.siteName)fields.push('Site name');
 if(v.deliveryStatus==='Unverified')fields.push('Delivery status');
 if(v.deliveryStatus==='Delivered'&&!v.deliveryDate)fields.push('Delivery date');
 if(v.deliveryStatus==='Not delivered'&&!v.ipoSharedDate)fields.push('IPO shared date');
 if(['Unverified','Review needed'].includes(v.installationStatus))fields.push('Installation status');
 if(v.installationStatus==='Completed'&&!v.installationDate)fields.push('Installation completion date');
 if(!v.invoiceReference)fields.push('System invoice reference');
 if(!positive(v.invoiceAmount))fields.push('System invoice amount');
 if(v.invoiceStatus==='Unverified')fields.push('Invoice submission status');
 if(v.invoiceStatus==='Submitted'&&!v.invoiceSubmittedDate)fields.push('Invoice submission date');
 if(v.paymentStatus==='Unverified')fields.push('Remaining system payment status');
 if(v.paymentStatus==='Received'&&!v.paymentReceivedDate)fields.push('Payment received date');
 if(v.paymentStatus==='Received'&&!positive(v.paymentReceivedAmount))fields.push('Payment received amount');
 return fields;
}
export function dataReviewRows(programRows:any[]){
 return programRows.flatMap(p=>{const r=p.snapshot.managementRegister;if(!r)return[];return r.sites.filter((s:any)=>s.recoveryStatus?.dataRequired||s.recoveryStatus?.dataReview||r.installationAlerts?.[s.orderNumber]?.status==='Review needed by Accounts').map((s:any)=>{
  const values=reviewValues(r,s),required=missingReviewFields(values),completed=Boolean(r.completionApprovals?.[s.orderNumber]||r.completionConfirmations?.[s.orderNumber]);
  return {id:`${p.program_key}:${s.orderNumber}`,programKey:p.program_key,expectedVersion:p.version,configuration:r.configuration,orderNumber:s.orderNumber,siteName:values.siteName,values,missing:required,status:completed?'Completed':values.deliveryStatus==='Delivered'&&values.installationStatus==='Pending'?'Delivered — installation pending':values.deliveryStatus==='Not delivered'?'Awaiting delivery':'Review required',resolved:required.length===0,notes:s.recoveryStatus?.dataReview?.notes??''};
 });}).sort((a,b)=>a.programKey.localeCompare(b.programKey)||Number(a.orderNumber.split('/')[0])-Number(b.orderNumber.split('/')[0]));
}
export function correctUpsReviewSnapshot(snapshot:any,raw:unknown,actor:string,now=new Date()){
 const input=inputSchema.parse(raw),next=structuredClone(snapshot),register=next.managementRegister;
 const site=register?.sites.find((s:any)=>s.orderNumber===input.orderNumber),previous=site?.recoveryStatus??{},oldAlert=register?.installationAlerts?.[input.orderNumber];
 if(!site||!(previous.dataRequired||previous.dataReview||oldAlert?.status==='Review needed by Accounts'))throw new HttpError(422,'Select a site in Data Required.');
 if(register.completionApprovals?.[input.orderNumber])throw new HttpError(409,'This site has an approved financial closure. Review that closure before changing its details.');
 const v=input.values,today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 for(const value of [v.deliveryDate,v.installationDate,v.ipoSharedDate,v.invoiceSubmittedDate,v.paymentReceivedDate])if(value&&value>today)throw new HttpError(422,'Actual dates cannot be in the future.');
 if(v.installationStatus==='Completed'&&v.deliveryStatus!=='Delivered')throw new HttpError(422,'A completed installation must be marked delivered.');
 if(v.deliveryDate&&v.installationDate&&v.installationDate<v.deliveryDate)throw new HttpError(422,'Installation completion cannot be before delivery.');
 if(v.paymentStatus==='Received'&&positive(v.invoiceAmount)&&positive(v.paymentReceivedAmount)&&!new Decimal(v.paymentReceivedAmount).eq(v.invoiceAmount))throw new HttpError(422,'Received means the remaining system invoice is fully paid; enter the matching invoice amount.');
 if(previous.dataReview&&isDeepStrictEqual(previous.dataReview.values,v)&&previous.dataReview.notes===input.notes)return {snapshot,unchanged:true};
 const savedAt=now.toISOString(),missing=missingReviewFields(v),original=previous.dataReview?.originalRecoveryStatus??structuredClone(previous);
 site.siteName=v.siteName;site.siteNameStatus=v.siteName?'Source identified':'Not supplied';site.ipoSharedAt=v.ipoSharedDate;
 site.recoveryStatus={...previous,deliveryStatus:v.deliveryStatus,installationStatus:v.installationStatus,deliveryDate:v.deliveryDate,invoiceStatus:v.invoiceStatus,invoiceSubmittedDate:v.invoiceSubmittedDate,systemPaymentStatus:v.paymentStatus,paymentStatus:v.paymentStatus,paymentReceivedDate:v.paymentReceivedDate,paymentReceivedAmount:v.paymentReceivedAmount,delayOwner:v.delayOwner,systemInvoices:v.invoiceReference&&positive(v.invoiceAmount)?[{invoice:v.invoiceReference,amount:new Decimal(v.invoiceAmount).toFixed(2),paymentReceived:v.paymentStatus==='Received',section:v.invoiceStatus==='Submitted'?'Submitted':'Not submitted',source:'Management data review'}]:[],dataReview:{values:v,notes:input.notes,originalRecoveryStatus:original,savedAt,savedBy:actor,complete:missing.length===0}};
 if(missing.length)site.recoveryStatus.dataRequired={...previous.dataRequired,fields:missing,reason:'Management details remain incomplete',updatedBy:actor,updatedAt:savedAt};else delete site.recoveryStatus.dataRequired;
 register.completionConfirmations={...register.completionConfirmations};
 if(v.installationStatus==='Completed')register.completionConfirmations[input.orderNumber]={...register.completionConfirmations[input.orderNumber],status:'Completed',completionDate:v.installationDate,confirmation:input.notes,confirmedBy:actor,confirmedAt:savedAt};
 else delete register.completionConfirmations[input.orderNumber];
 register.installationAlerts={...register.installationAlerts};
 if(v.deliveryStatus==='Delivered'&&v.installationStatus==='Pending')register.installationAlerts[input.orderNumber]={...oldAlert,orderNumber:input.orderNumber,status:'Delivered — installation pending',responsibleDepartment:'Operations',evidenceSiteName:v.siteName,reason:input.notes,nextAction:'Confirm site readiness and complete installation',deliveryDate:v.deliveryDate,delayOwner:v.delayOwner,resolvedAt:null,updatedBy:actor,updatedAt:savedAt};
 else if(['Unverified','Review needed'].includes(v.installationStatus))register.installationAlerts[input.orderNumber]={...oldAlert,orderNumber:input.orderNumber,status:v.installationStatus==='Review needed'?'Review needed by Accounts':'Further information required — documents awaited',responsibleDepartment:v.installationStatus==='Review needed'?'Accounts':'Operations',evidenceSiteName:v.siteName,reason:input.notes,nextAction:'Review the outstanding site details',deliveryDate:v.deliveryDate,delayOwner:v.delayOwner,resolvedAt:null,updatedBy:actor,updatedAt:savedAt};
 else if(oldAlert)register.installationAlerts[input.orderNumber]={...oldAlert,resolvedAt:savedAt,resolvedBy:actor};
 return {snapshot:next,unchanged:false};
}
async function allowed(pool:Pool,actor:string){const u=(await pool.query('SELECT active,role FROM users WHERE id=$1',[actor])).rows[0];if(!u?.active||!['Admin','Management'].includes(u.role))throw new HttpError(403,'Management access is required.');}
export async function upsDataReview(pool:Pool,actor:string,customer:'UBL'|'MBL'){
 await allowed(pool,actor);const programs=(await pool.query("SELECT DISTINCT ON(program_key) program_key,version,snapshot #- '{managementRegister,unreviewedCosting}' AS snapshot FROM ups_management_program_versions WHERE customer_code=$1 ORDER BY program_key,version DESC",[customer])).rows;
 const rows=dataReviewRows(programs);return {rows,total:rows.length,required:rows.filter(r=>!r.resolved).length};
}
export async function saveUpsDataReview(pool:Pool,actor:string,raw:unknown){
 const input=inputSchema.parse(raw);await allowed(pool,actor);
 return transaction(pool,async c=>{
  const user=(await c.query('SELECT active,role FROM users WHERE id=$1',[actor])).rows[0];
  if(!user?.active||!['Admin','Management'].includes(user.role))throw new HttpError(403,'Management access is required.');
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[input.programKey]);
  const previous=(await c.query('SELECT version,customer_code,snapshot FROM ups_management_program_versions WHERE program_key=$1 ORDER BY version DESC LIMIT 1',[input.programKey])).rows[0];
  if(!previous)throw new HttpError(404,'UPS register not found.');
  const change=correctUpsReviewSnapshot(previous.snapshot,input,actor);
  if(change.unchanged)return {version:previous.version,unchanged:true};
  if(previous.version!==input.expectedVersion)throw new HttpError(409,'The register changed. Refresh Data Required and reopen the site before saving; your entered details are still shown.');
  const version=previous.version+1;
  await c.query('INSERT INTO ups_management_program_versions(id,program_key,version,customer_code,snapshot,notes,created_by)VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),input.programKey,version,previous.customer_code,change.snapshot,`Management data review ${input.orderNumber}: ${input.notes}`,actor]);
  await c.query('INSERT INTO audit_log(user_id,action)VALUES($1,$2)',[actor,`ups.data-review:${input.programKey}:v${version}:${input.orderNumber}:${input.notes}`]);
  return {version,unchanged:false,row:dataReviewRows([{program_key:input.programKey,version,snapshot:change.snapshot}]).find(r=>r.orderNumber===input.orderNumber)};
 });
}
