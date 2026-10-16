import type {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {HttpError} from '../http/errors.js';
import {transaction} from '../db/transaction.js';
import {upsBatchProgress} from './ups-progress.js';

const manifest=z.object({filename:z.string().min(1).max(200),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const nameEvidence=z.object({name:z.string().max(1000),row:z.number().int().positive(),description:z.string().max(5000),filename:z.string().max(200).optional()}).strict();
const siteSchema=z.object({orderNumber:z.string().regex(/^(?:[1-9]\d*\/[1-9]\d*)?$/),legacyJobId:z.string().regex(/^(?:CHJ-\d+)?$/).default(''),ipoNumber:z.string().regex(/^(?:CHP-\d+)?$/).default(''),siteName:z.string().max(1000).default(''),siteCode:z.string().max(100).default(''),siteNameStatus:z.enum(['Source identified','Needs review','Not supplied']).default('Not supplied'),nameEvidence:z.array(nameEvidence).max(100).default([]),invoiceReference:z.string().trim().max(200),invoiceDate:z.union([z.iso.date(),z.literal('')]),invoiceStatus:z.enum(['Invoiced','Not invoiced']),sourceRow:z.number().int().positive(),sourceFilename:z.string().max(200).optional(),sourceSheet:z.string().max(200).optional()}).strict();
const costingSchema=z.object({status:z.literal('Unreviewed'),analysisRows:z.array(z.object({sourceRow:z.number().int().positive(),values:z.array(z.union([z.string(),z.number(),z.null()])).max(30)}).strict()).max(1000),ledgerTransactions:z.array(z.object({row:z.number().int().positive(),job:z.string(),phase:z.string(),gl:z.string(),date:z.iso.date(),description:z.string().max(5000),reference:z.string().nullable(),debit:z.string(),credit:z.string()}).strict()).max(20000),sourceFiles:z.array(manifest).max(20),notes:z.string().max(2000)}).strict();
const registerSchema=z.object({customer:z.enum(['MBL','UBL']),projectReference:z.string().regex(/^CHP-\d+$/),configuration:z.enum(['6-5','6-10']),totalSites:z.number().int().positive().max(10000),sourceSheet:z.string().min(1).max(200),source:manifest,sites:z.array(siteSchema).min(1).max(10000),unreviewedCosting:costingSchema.optional()}).strict();

/** Management-only historical register. No workflow, IPO, site-master or price writes. */
export async function importUpsManagementRegister(pool:Pool,actor:string,raw:unknown){
 const input=registerSchema.parse(raw);
 const positions=new Set<string>();
 if(input.sites.length>input.totalSites)throw new HttpError(422,'Listed entries exceed the batch order quantity.');
 for(const site of input.sites){
  const identity=site.orderNumber||site.legacyJobId;
  const [position,total]=site.orderNumber.split('/').map(Number);
  if(!identity||positions.has(identity)||site.orderNumber&&(total!==input.totalSites||position>total))throw new HttpError(422,'Order positions or legacy job IDs must be unique and within the stated order total.');
  if(site.invoiceStatus==='Invoiced'&&(!site.invoiceReference||!site.invoiceDate))throw new HttpError(422,'An invoiced entry needs its source invoice reference and date.');
  if(site.invoiceStatus==='Not invoiced'&&(site.invoiceReference||site.invoiceDate))throw new HttpError(422,'Do not invent invoice details for an entry marked not invoiced.');
  positions.add(identity);
 }
 input.sites.sort((a,b)=>a.orderNumber&&b.orderNumber?Number(a.orderNumber.split('/')[0])-Number(b.orderNumber.split('/')[0]):a.orderNumber?-1:b.orderNumber?1:a.legacyJobId.localeCompare(b.legacyJobId));
 return transaction(pool,async c=>{
  const user=(await c.query('SELECT active,role FROM users WHERE id=$1',[actor])).rows[0];
  if(!user?.active||!['Admin','Management'].includes(user.role))throw new HttpError(403,'Director reporting requires management access.');
  const key=`${input.customer}-UPS-${input.configuration}`;
  const framework=(await c.query('SELECT f.id FROM project_framework_current f JOIN customers c ON c.id=f.customer_id WHERE upper(c.short_code)=$1 AND f.configuration_key=$2 AND f.payload->>\'type\'=\'bank-ups\'',[input.customer,key])).rows[0];
  if(!framework)throw new HttpError(422,'An approved customer UPS option is required.');
  const programKey=`UPS:${input.customer}:${input.projectReference}`;
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[programKey]);
  const previous=(await c.query('SELECT version,snapshot FROM ups_management_program_versions WHERE program_key=$1 ORDER BY version DESC LIMIT 1',[programKey])).rows[0];
  const register={...input,frameworkId:framework.id};
  const snapshot={totalSites:input.totalSites,configurationKeys:[key],managementRegister:register};
  if(previous){
   if(!isDeepStrictEqual(previous.snapshot,snapshot))throw new HttpError(409,'This Management order already has different saved information. Review it before replacing any entries.');
   return{programKey,version:previous.version,imported:0,unchanged:input.sites.length};
  }
  await c.query('INSERT INTO ups_management_program_versions(id,program_key,version,customer_code,snapshot,notes,created_by)VALUES($1,$2,1,$3,$4,$5,$6)',[randomUUID(),programKey,input.customer,snapshot,`Received order register from ${input.source.filename}, ${input.sourceSheet}; costing deferred; no workflow issuance`,actor]);
  await c.query('INSERT INTO audit_log(user_id,action)VALUES($1,$2)',[actor,`ups.management-register:${programKey}:v1:${input.sites.length} entries:sha256:${input.source.sha256}`]);
  return{programKey,version:1,imported:input.sites.length,unchanged:0};
 });
}

/** Merge reporting identities only; a later real issuance enriches its existing order position. */
export function upsActiveRegister(programRows:any[],issued:any[],availableConfigurations:string[]=[]){
 const programs=programRows.filter(p=>p.snapshot.managementRegister).map(p=>({...p.snapshot.managementRegister,programKey:p.program_key,version:p.version}));
 const rows:any[]=[],matched=new Set<string>();
 for(const p of programs){
  for(const s of p.sites){
   const issuance=s.orderNumber?issued.find(r=>[p.projectReference,s.ipoNumber].includes(r.number)&&r.orderNumber===s.orderNumber&&r.configuration===p.configuration):undefined;
   if(issuance)matched.add(issuance.id);
   const completion=p.completionApprovals?.[s.orderNumber],operationalCompletion=p.completionConfirmations?.[s.orderNumber],installationAlert=p.installationAlerts?.[s.orderNumber];
   rows.push({id:`${p.programKey}:${s.orderNumber||s.legacyJobId}`,source:'Management register',status:completion?'Approved closed':operationalCompletion?'Completed — data required':installationAlert?.status??'Active',completion,operationalCompletion,installationAlert,dataRequired:s.recoveryStatus?.dataRequired??null,projectReference:p.projectReference,configuration:p.configuration,orderNumber:s.orderNumber,legacyJobId:s.legacyJobId??'',number:s.ipoNumber??'',site:issuance?.site||s.siteName||'',siteCode:issuance?.siteCode||s.siteCode||'',siteNameStatus:issuance?.site?'Source identified':s.siteNameStatus,nameEvidence:s.nameEvidence??[],invoiceReference:s.invoiceReference,invoiceDate:s.invoiceDate,invoiceStatus:s.invoiceStatus,sourceFilename:s.sourceFilename||p.source.filename,sourceSheet:s.sourceSheet||p.sourceSheet,sourceRow:s.sourceRow,costingStatus:completion?.actualCost!=null?'Recorded in Actual from costing sheet':p.unreviewedCosting?'Saved — awaiting review':'Not supplied',ipoId:issuance?.id??null});
  }
 }
 for(const r of issued){if(matched.has(r.id))continue;rows.push({id:r.id,source:'Confirmed sale',status:'Active',projectReference:r.number,number:r.number,configuration:r.configuration,orderNumber:r.orderNumber,site:r.site,siteCode:r.siteCode,invoiceReference:'',invoiceDate:'',invoiceStatus:'Not entered',ipoId:r.id});}
 const configurations=[...new Set([...availableConfigurations,...programs.map(p=>p.configuration),...issued.map(r=>r.configuration)])].sort((a,b)=>Number(a.split('-')[1])-Number(b.split('-')[1])).map(configuration=>({configuration,activeSites:rows.filter(r=>r.configuration===configuration).length}));
 const orders=programs.map(p=>{const active=rows.filter(r=>r.projectReference===p.projectReference&&r.configuration===p.configuration).length;return{programKey:p.programKey,projectReference:p.projectReference,configuration:p.configuration,totalSites:p.totalSites,listedSites:p.sites.length,activeSites:active,remainingSites:Math.max(0,p.totalSites-active),invoicedSites:p.sites.filter((s:any)=>s.invoiceStatus==='Invoiced').length,progressSummary:upsBatchProgress({...p,ipoSharedDates:Object.fromEntries(issued.filter(r=>r.configuration===p.configuration&&[p.projectReference,...p.sites.map((s:any)=>s.ipoNumber)].includes(r.number)&&r.orderNumber&&r.issuedAt).map(r=>[r.orderNumber,r.issuedAt]))})};});
 return{rows,programs:orders,configurations,activeSites:rows.length,importedSites:rows.filter(r=>!r.ipoId).length,totalOrdered:orders.reduce((n,p)=>n+p.totalSites,0),remainingSites:orders.reduce((n,p)=>n+p.remainingSites,0)};
}
