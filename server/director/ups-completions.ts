import {Decimal} from 'decimal.js';
import type {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';
import {frameworkBasis} from '../project-workflow/basis.js';

const source=z.object({fileId:z.string().min(1),filename:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/),sheet:z.string().min(1),url:z.url()}).strict();
const evidence=z.object({row:z.number().int().positive(),invoice:z.string().min(1),siteName:z.string(),installationText:z.string(),section:z.string()}).strict();
const costSource=z.object({filename:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/),sheet:z.string().min(1),column:z.literal('L')}).strict();
const inputSchema=z.object({costSource:costSource.optional(),programKey:z.string().min(1),expectedVersion:z.number().int().positive(),source,notes:z.string().min(1),sites:z.array(z.object({orderNumber:z.string().regex(/^\d+\/\d+$/),completionDate:z.iso.date().nullable(),actualCost:z.object({amount:z.string().regex(/^\d+\.\d{2}$/),sourceRow:z.number().int().positive()}).strict().optional(),overridePendingInstallation:z.boolean().default(false),evidence:z.array(evidence).min(1)}).strict()).min(1)}).strict();

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
  const seen=new Set<string>(),costs=new Map<string,any>();
  if(input.costSource&&(input.costSource.filename!==register.source.filename||input.costSource.sha256!==register.source.sha256||input.costSource.sheet!==register.sourceSheet))throw new HttpError(422,'Actual cost source does not match the saved costing workbook.');
  for(const s of input.sites){
   if(seen.has(s.orderNumber)||!register.sites.some((r:any)=>r.orderNumber===s.orderNumber))throw new HttpError(422,'Completion must match one existing order position.');
   seen.add(s.orderNumber);
   if(Boolean(s.actualCost)!==Boolean(input.costSource))throw new HttpError(422,'Each actual cost needs the matching saved workbook source.');
   if(s.actualCost){
    const site=register.sites.find((r:any)=>r.orderNumber===s.orderNumber),row=register.unreviewedCosting?.analysisRows?.find((r:any)=>r.sourceRow===s.actualCost!.sourceRow),raw=row?.values?.[11];
    if(site.sourceRow!==s.actualCost.sourceRow||!row||String(row.values[0])!==s.orderNumber.split('/')[0]||(row.values[1]!==site.invoiceReference&&!(site.invoiceReferenceCorrection?.from===row.values[1]&&site.invoiceReferenceCorrection?.to===site.invoiceReference))||typeof raw!=='number'||!Number.isFinite(raw)||raw<0)throw new HttpError(422,'Actual cost must match the site row in the saved costing sheet.');
    const amount=new Decimal(raw).toDecimalPlaces(2,Decimal.ROUND_HALF_UP).toFixed(2);
    if(amount!==s.actualCost.amount)throw new HttpError(422,'Actual cost differs from the saved total cost per site.');
    costs.set(s.orderNumber,{amount,sourceRow:row.sourceRow,cell:'L'+row.sourceRow,rawValue:String(raw),source:input.costSource});
   }

   if(register.installationAlerts?.[s.orderNumber]&&!register.installationAlerts[s.orderNumber].resolvedAt&&register.installationAlerts[s.orderNumber].status!=='Completed — details verification required')throw new HttpError(409,'This site has an unresolved installation alert; installation must be completed before closure.');
   if(!s.overridePendingInstallation&&(!s.completionDate||s.evidence.some(e=>/pend/i.test(e.installationText))))throw new HttpError(422,'Pending installation needs explicit Management override.');
   if(s.evidence.some(e=>!e.invoice.replace(/\s/g,'').endsWith(s.orderNumber)))throw new HttpError(422,'Invoice order number does not match the site.');
  }
  const old=register.completionApprovals??{};
  const additions=input.sites.filter(s=>{
   const saved=old[s.orderNumber];
   if(!saved)return true;
   if(!isDeepStrictEqual(saved.evidence,s.evidence)||!isDeepStrictEqual(saved.source,input.source)||saved.completionDate!==s.completionDate)throw new HttpError(409,'This site has different saved completion evidence.');
   const cost=costs.get(s.orderNumber);
   if(cost){
    if(saved.actualCost==null)return true;
    if(saved.actualCost!==cost.amount||!isDeepStrictEqual(saved.actualCostEvidence,cost))throw new HttpError(409,'This site already has different saved actual costing.');
   }
   return false;
  });
  if(!additions.length)return{programKey:input.programKey,version:previous.version,approved:0,unchanged:input.sites.length};
  if(previous.version!==input.expectedVersion)throw new HttpError(409,'The register changed; review its latest version before approval.');
  const basis=await frameworkBasis(pool,c,{customer_id:(await c.query('SELECT customer_id FROM project_framework_versions WHERE id=$1',[register.frameworkId])).rows[0]?.customer_id,site_name:'Historical completion approval',site_code:'PORTFOLIO',route:'direct-framework'},register.frameworkId);
  const approvals={...old},approvedAt=new Date().toISOString();
  for(const s of additions){
   const previousApproval=old[s.orderNumber],cost=costs.get(s.orderNumber);
   approvals[s.orderNumber]={...s,source:input.source,notes:input.notes,status:'Approved closed',sellingExGst:previousApproval?.sellingExGst??basis.order.allocation.subtotal,actualCost:cost?.amount??previousApproval?.actualCost??null,actualCostEvidence:cost??previousApproval?.actualCostEvidence??null,actualCostStatus:cost?'Recorded from costing sheet':previousApproval?.actualCostStatus??'Pending review',approvedBy:previousApproval?.approvedBy??actor,approvedAt:previousApproval?.approvedAt??approvedAt,...(cost?{actualCostRecordedBy:actor,actualCostRecordedAt:approvedAt}:{})};
  }
  const snapshot=structuredClone(previous.snapshot);snapshot.managementRegister.completionApprovals=approvals;
  const version=previous.version+1;
  await c.query('INSERT INTO ups_management_program_versions(id,program_key,version,customer_code,snapshot,notes,created_by)VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),input.programKey,version,previous.customer_code,snapshot,input.notes,actor]);
  await c.query('INSERT INTO audit_log(user_id,action)VALUES($1,$2)',[actor,`ups.management-completion:${input.programKey}:v${version}:${additions.length} sites:${costs.size?'actual-cost-recorded':'actual-cost-pending'}:sha256:${input.source.sha256}`]);
  return{programKey:input.programKey,version,approved:additions.length,unchanged:input.sites.length-additions.length};
 });
}
