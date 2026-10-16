import type {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';
import {frameworkBasis} from '../project-workflow/basis.js';

const source=z.object({fileId:z.string().min(1),filename:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/),sheet:z.string().min(1),url:z.url()}).strict();
const evidence=z.object({row:z.number().int().positive(),invoice:z.string().min(1),siteName:z.string(),installationText:z.string(),section:z.string()}).strict();
const inputSchema=z.object({programKey:z.string().min(1),expectedVersion:z.number().int().positive(),source,notes:z.string().min(1),sites:z.array(z.object({orderNumber:z.string().regex(/^\d+\/\d+$/),completionDate:z.iso.date().nullable(),overridePendingInstallation:z.boolean().default(false),evidence:z.array(evidence).min(1)}).strict()).min(1)}).strict();

/** Director-approved historical completions; actual expenses remain unknown, never zero. */
export async function approveUpsRegisterCompletions(pool:Pool,actor:string,raw:unknown){
 const input=inputSchema.parse(raw);
 return transaction(pool,async c=>{
  const user=(await c.query('SELECT active,role FROM users WHERE id=$1',[actor])).rows[0];
  if(!user?.active||!['Admin','Management'].includes(user.role))throw new HttpError(403,'Management approval is required.');
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[input.programKey]);
  const previous=(await c.query('SELECT version,customer_code,snapshot FROM ups_management_program_versions WHERE program_key=$1 ORDER BY version DESC LIMIT 1',[input.programKey])).rows[0];
  const register=previous?.snapshot.managementRegister;
  if(!register)throw new HttpError(422,'Select an existing imported UPS site register.');
  const seen=new Set<string>();
  for(const s of input.sites){
   if(seen.has(s.orderNumber)||!register.sites.some((r:any)=>r.orderNumber===s.orderNumber))throw new HttpError(422,'Completion must match one existing order position.');
   seen.add(s.orderNumber);
   if(register.installationAlerts?.[s.orderNumber])throw new HttpError(409,'This site has an unresolved installation alert; installation must be completed before closure.');
   if(!s.overridePendingInstallation&&(!s.completionDate||s.evidence.some(e=>/pend/i.test(e.installationText))))throw new HttpError(422,'Pending installation needs explicit Management override.');
   if(s.evidence.some(e=>!e.invoice.replace(/\s/g,'').endsWith(s.orderNumber)))throw new HttpError(422,'Invoice order number does not match the site.');
  }
  const old=register.completionApprovals??{};
  const additions=input.sites.filter(s=>{
   const saved=old[s.orderNumber];
   if(!saved)return true;
   if(!isDeepStrictEqual(saved.evidence,s.evidence)||!isDeepStrictEqual(saved.source,input.source)||saved.completionDate!==s.completionDate)throw new HttpError(409,'This site has different saved completion evidence.');
   return false;
  });
  if(!additions.length)return{programKey:input.programKey,version:previous.version,approved:0,unchanged:input.sites.length};
  if(previous.version!==input.expectedVersion)throw new HttpError(409,'The register changed; review its latest version before approval.');
  const basis=await frameworkBasis(pool,c,{customer_id:(await c.query('SELECT customer_id FROM project_framework_versions WHERE id=$1',[register.frameworkId])).rows[0]?.customer_id,site_name:'Historical completion approval',site_code:'PORTFOLIO',route:'direct-framework'},register.frameworkId);
  const approvals={...old},approvedAt=new Date().toISOString();
  for(const s of additions)approvals[s.orderNumber]={...s,source:input.source,notes:input.notes,status:'Approved closed',sellingExGst:basis.order.allocation.subtotal,actualCost:null,actualCostStatus:'Pending review',approvedBy:actor,approvedAt};
  const snapshot=structuredClone(previous.snapshot);snapshot.managementRegister.completionApprovals=approvals;
  const version=previous.version+1;
  await c.query('INSERT INTO ups_management_program_versions(id,program_key,version,customer_code,snapshot,notes,created_by)VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),input.programKey,version,previous.customer_code,snapshot,input.notes,actor]);
  await c.query('INSERT INTO audit_log(user_id,action)VALUES($1,$2)',[actor,`ups.management-completion:${input.programKey}:v${version}:${additions.length} sites:actual-cost-pending:sha256:${input.source.sha256}`]);
  return{programKey:input.programKey,version,approved:additions.length,unchanged:input.sites.length-additions.length};
 });
}
