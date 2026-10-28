import {Decimal} from 'decimal.js';
import {z} from 'zod';
import {materialDocumentPolicy} from '../../shared/material-documents.js';

const quantity=z.string().regex(/^\d{1,14}(?:\.\d{1,6})?$/).transform(v=>new Decimal(v).toString());
const optionalQuantity=z.union([quantity,z.literal(''),z.null()]);
const line=z.object({
 documentPolicyVersion:z.literal(2).optional(),key:z.uuid(),itemId:z.string().trim().min(1).max(200),description:z.string().trim().min(1).max(1000),
 unit:z.string().trim().min(1).max(40),out:quantity,sites:z.array(z.string().min(1).max(160)).min(1).max(1000),
}).strict();
const usage=z.object({siteId:z.string().min(1).max(160),lineKey:z.uuid(),used:optionalQuantity,issued:optionalQuantity.optional(),returned:optionalQuantity.optional()}).strict();
const extra=z.object({documentId:z.uuid(),lineKey:z.uuid(),kind:z.enum(['warehouse-do','local-purchase']),quantity,verified:z.boolean()}).strict();
const receipt=z.object({id:z.uuid(),reference:z.string().trim().min(1).max(200),dispatchId:z.uuid(),evidenceId:z.uuid(),status:z.enum(['uploaded','verified']),allocationProvisional:z.boolean().default(false),lines:z.array(z.object({lineKey:z.uuid(),quantity}).strict()).max(2000)}).strict();
export const materialDispatchSchema=z.object({
 id:z.uuid(),reference:z.string().trim().min(1).max(200),warehouse:z.string().trim().min(1).max(200),
 kind:z.enum(['fixed','variable']),parent:z.boolean(),
 sites:z.array(z.object({id:z.string().min(1).max(160),ipo:z.string().min(1).max(100),installation:z.boolean(),basisId:z.uuid(),basisVersion:z.number().int().positive()}).strict()).min(1).max(1000),
 lines:z.array(line).min(1).max(2000),usage:z.array(usage).max(20000).default([]),extraSources:z.array(extra).max(2000).default([]),receipts:z.array(receipt).max(2000).default([]),
}).strict();
export type MaterialDispatch=z.infer<typeof materialDispatchSchema>;

/** The repository must resolve approved basis versions, final stock IDs, receipt
 * verification and evidence access before using this server-owned snapshot.
 * Document previews and per-site usage never create another warehouse movement. */
export function validateMaterialDispatch(input:unknown):MaterialDispatch{
 const dispatch=materialDispatchSchema.parse(input),sites=new Set(dispatch.sites.map(s=>s.id)),lines=new Map(dispatch.lines.map(r=>[r.key,r]));
 if(sites.size!==dispatch.sites.length||lines.size!==dispatch.lines.length)throw Error('Duplicate site or material row.');
 if(dispatch.kind==='fixed'&&(dispatch.parent||dispatch.sites.length!==1))throw Error('Issue fixed materials for one site at a time.');
 if(!dispatch.parent&&dispatch.sites.length!==1)throw Error('Multiple sites require a Parent DO.');
 if(dispatch.kind==='variable'&&dispatch.sites.some(s=>!s.installation))throw Error('Delivery-only product sales do not have an installation variance dispatch.');
 if(!dispatch.lines.some(r=>new Decimal(r.out).gt(0)))throw Error('An issued warehouse dispatch needs a positive material quantity.');
 for(const row of dispatch.lines){
  if(new Set(row.sites).size!==row.sites.length||row.sites.some(s=>!sites.has(s)))throw Error('Material row is allocated outside this dispatch.');
  const policy=materialDocumentPolicy(row);
  if(policy.group==='non-stock'||policy.classificationRequired)throw Error('Resolve the stock item classification before dispatch.');
  // Delivery-only orders issue products directly, including a cable product;
  // they do not create installation usage/sign-off or Parent DO work.
  if(dispatch.sites[0].installation&&policy.variableDispatch!==(dispatch.kind==='variable'))throw Error('Keep fixed and variable materials on their separate dispatches.');
 }
 const usageKeys=new Set<string>();
 for(const entry of dispatch.usage){
  const row=lines.get(entry.lineKey),key=entry.siteId+'\0'+entry.lineKey;
  if(!row?.sites.includes(entry.siteId))throw Error('Usage belongs to another site or material row.');
  if(usageKeys.has(key))throw Error('Duplicate site usage.');usageKeys.add(key);
 }
 const extras=new Map<string,string>();
 for(const entry of dispatch.extraSources){
  if(!lines.has(entry.lineKey))throw Error('Additional evidence belongs to another material row.');
  if(entry.documentId===dispatch.id)throw Error('The original dispatch is already counted; do not add it again.');
  const key=entry.kind+'\0'+entry.documentId+'\0'+entry.lineKey,signature=JSON.stringify(entry);
  if(extras.has(key)&&extras.get(key)!==signature)throw Error('Conflicting quantities for the same additional source.');extras.set(key,signature);
 }
 const receiptIds=new Set<string>(),references=new Set<string>(),evidenceIds=new Set<string>();
 for(const batch of dispatch.receipts){
  if(batch.dispatchId!==dispatch.id)throw Error('Warehouse return belongs to another dispatch.');
  const reference=batch.reference.toUpperCase();
  if(receiptIds.has(batch.id)||references.has(reference)||evidenceIds.has(batch.evidenceId))throw Error('This warehouse return batch or signed evidence is already recorded.');
  receiptIds.add(batch.id);references.add(reference);evidenceIds.add(batch.evidenceId);
  const keys=new Set<string>();for(const entry of batch.lines){if(!lines.has(entry.lineKey)||keys.has(entry.lineKey))throw Error('Invalid or duplicate warehouse return line.');keys.add(entry.lineKey);}
  if(batch.status==='verified'&&!batch.lines.some(r=>new Decimal(r.quantity).gt(0)))throw Error('A verified warehouse return needs a positive counted quantity.');
 }
 return dispatch;
}

export function reconcileMaterialDispatch(input:unknown){
 const dispatch=validateMaterialDispatch(input);
 const rows=dispatch.lines.map(row=>{
  const applicable=row.sites.map(siteId=>dispatch.usage.find(u=>u.siteId===siteId&&u.lineKey===row.key));
  const usageComplete=applicable.every(u=>u&&u.used!==null&&u.used!=='');
  const knownUsed=applicable.reduce((sum,u)=>u&&u.used!==null&&u.used!==''?sum.plus(u.used):sum,new Decimal(0));
  const used=usageComplete?applicable.reduce((sum,u)=>sum.plus(u!.used!),new Decimal(0)):null;
  const extras=new Map(dispatch.extraSources.filter(s=>s.lineKey===row.key).map(s=>[s.kind+'\0'+s.documentId,s]));
  const extraWarehouseOut=[...extras.values()].filter(s=>s.verified&&s.kind==='warehouse-do').reduce((n,s)=>n.plus(s.quantity),new Decimal(0));
  const localPurchase=[...extras.values()].filter(s=>s.verified&&s.kind==='local-purchase').reduce((n,s)=>n.plus(s.quantity),new Decimal(0));
  const warehouseReturn=dispatch.receipts.filter(r=>r.status==='verified').flatMap(r=>r.lines).filter(r=>r.lineKey===row.key).reduce((n,r)=>n.plus(r.quantity),new Decimal(0));
  const warehouseOut=new Decimal(row.out).plus(extraWarehouseOut),available=warehouseOut.plus(localPurchase);
  const expectedReturn=used===null?null:available.minus(used),remaining=expectedReturn?.minus(warehouseReturn)??null;
  const unverifiedSources=[...extras.values()].some(s=>!s.verified),unverifiedReturns=dispatch.receipts.some(r=>r.status!=='verified'&&r.lines.some(l=>l.lineKey===row.key));
  const provisionalReturn=dispatch.receipts.some(r=>r.allocationProvisional&&r.lines.some(l=>l.lineKey===row.key));
  return {...row,warehouseOut:warehouseOut.toString(),localPurchase:localPurchase.toString(),used:used?.toString()??null,expectedReturn:expectedReturn?.toString()??null,verifiedWarehouseReturn:warehouseReturn.toString(),remaining:remaining?.toString()??null,
   status:unverifiedSources?'Additional evidence pending':provisionalReturn?'Provisional return allocation needs verification':knownUsed.plus(warehouseReturn).gt(available)?'Additional DO / LP evidence or quantity correction needed':!usageComplete?'Usage pending':remaining!.lt(0)?'Additional DO / LP evidence or quantity correction needed':remaining!.gt(0)?'Unused quantity needs accounting':unverifiedReturns?'Warehouse receipt verification pending':'Reconciled',
   ready:usageComplete&&!unverifiedSources&&!unverifiedReturns&&!provisionalReturn&&remaining!.isZero(),
  };
 });
 return {dispatch,rows,ready:rows.every(r=>r.ready),stockPosting:false as const};
}

/** Site documents are evidence projections, never stock-posting commands. */
export function materialSiteDocuments(input:unknown,siteId:string){
 const result=reconcileMaterialDispatch(input),dispatch=result.dispatch,site=dispatch.sites.find(s=>s.id===siteId);
 if(!site)throw Error('Site is not part of this dispatch.');
 const records=dispatch.lines.filter(r=>r.sites.includes(siteId)).map(row=>{
  const entry=dispatch.usage.find(u=>u.siteId===siteId&&u.lineKey===row.key),used=entry?.used??null;
  const summary=result.rows.find(r=>r.key===row.key)!;
  const policy=materialDocumentPolicy(row),parentIssue=policy.customerUsageSignoff?used:entry?.issued??null;
  return {...row,used:used===''?null:used,issuedAtSite:dispatch.parent?(parentIssue===''?null:parentIssue):new Decimal(summary.warehouseOut).plus(summary.localPurchase).toString(),returnedAtSite:entry?.returned===''?null:entry?.returned??null,policy};
 });
 return {site,reference:dispatch.reference,
  fixedDelivery:dispatch.kind==='fixed'?records:[],
  customerUsage:site.installation?records.filter(r=>r.policy.customerUsageSignoff):[],
  installationReconciliation:site.installation?records.filter(r=>r.policy.installationReconciliation):[],
  stockPosting:false as const,
 };
}
