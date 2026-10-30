import type {Pool,PoolClient} from 'pg';
import {invoiceIdentity} from './billing-model.js';
type Row=Record<string,any>;
export const submissionKey=(value:unknown)=>String(value??'').replace(/^registered-/,'').replace(/^live-ipo:/,'issued:');
export const submissionMilestone=(value:unknown)=>value==='advance'?'delivery':value;
export const submissionReferences=(values:unknown[])=>[...new Set(values.filter(v=>typeof v==='string'&&v.trim()).map(v=>String(v).trim()))];
export async function invoiceSubmissions(c:Pool|PoolClient){return (await c.query('SELECT *,submitted_on::text AS submitted_on FROM accounts_invoice_submissions ORDER BY created_at,id')).rows;}
export function submissionMatches(row:Row,event:Row){return submissionMilestone(row.milestone)===event.milestone&&[row.sourceKey,row.key,row.site_key].filter(Boolean).some(key=>submissionKey(key)===event.source_key);}
/** Reporting overlay only. Never replace invoice references, quantities or money. */
export function applyInvoiceSubmissionStages(snapshot:Row,events:Row[]):Row{
 return {...snapshot,registers:(snapshot.registers??[]).map((register:Row)=>({...register,rows:register.rows.map((row:Row)=>{
  const matches=events.filter(e=>e.source_key===submissionKey(row.key));if(!matches.length)return row;
  let next={...row};
  for(const e of matches){
   const existing=submissionReferences([...(row.invoiceReferences??[]),...(row.verifiedInvoiceReferences??[])]),saved: string[]=e.snapshot.invoiceReferences??[];
   if(!existing.some(ref=>saved.includes(ref)))continue;
   if(row.program==='Solar 70'){const phase=e.milestone==='delivery'?'advance':'completion';next[phase]={...next[phase],submitted:true,submissionEvidence:e.submitted_on};}
   else next={...next,singleInvoiceSubmitted:true,invoiceStatus:e.submitted_on};
  }
  return next;
 })}))};
}
/** Preserve every existing amount/pending/receipt/reference field. An external PT
 * invoice without loaded financial values remains explicitly unknown, never zero. */
export function applyInvoiceSubmissionBilling(rows:Row[],events:Row[]):Row[]{
 const result=rows.map(row=>{
  const matches=events.filter(e=>(e.snapshot.billingIds??[]).includes(row.id)&&e.snapshot.customer===row.customer);
  if(matches.length!==1)return row;
  return {...row,submissionId:matches[0].id,submission:'Submitted',date:matches[0].submitted_on,dateBasis:'Days since verified submission'};
 });
 for(const e of events){
  if(result.some(r=>(e.snapshot.billingIds??[]).includes(r.id)&&e.snapshot.customer===r.customer))continue;
  result.push({id:'submission:'+e.id,submissionId:e.id,customer:e.snapshot.customer,category:e.milestone==='delivery'?'System · delivery':'System · completion',ipo:e.snapshot.ipo??'',site:e.snapshot.site??'',invoice:e.invoice_reference,amount:null,pending:null,receiptConfirmed:false,date:e.submitted_on,dateBasis:'Days since verified submission',submission:'Submitted',notes:'Existing PT invoice submitted. Original invoice amount and unpaid balance are not loaded; no amounts or payments inferred.',minimum:false});
 }
 return result;
}
export function submissionBillingBasis(candidate:Row,source:Row|undefined,rows:Row[]){
 const key=submissionKey(candidate.sourceKey??candidate.key),sourceRows=source?.snapshot.registers.flatMap((r:Row)=>r.rows??[])??[];
 const exact=sourceRows.filter((r:Row)=>r.key===key),original=exact.length===1?exact[0]:undefined;
 const customer=String(original?.customer??candidate.customer??'');
 const bank=customer==='MBL'||key.startsWith('MBL:')?'Meezan Bank Limited':customer==='UBL'||key.startsWith('UBL:')?'United Bank Limited':customer||'Customer not recorded';
 const refs=submissionReferences(candidate.invoiceReferences??[]),ids:string[]=[];
 if(original?.program==='Solar 70')ids.push(`${key}:${candidate.milestone==='delivery'?'advance':'completion'}`);
 else if(original?.kind==='UPS')for(const ref of refs){const id=invoiceIdentity(ref);if(id)ids.push('system:'+bank+':'+id);}
 // A PT reference on an unlinked native site must not claim an existing invoice
 // from a different reviewed source site merely because its text was entered.
 const linked=rows.filter(r=>r.category.startsWith('System')&&r.customer===bank&&refs.some(ref=>r.invoice===ref||invoiceIdentity(ref)&&invoiceIdentity(r.invoice)===invoiceIdentity(ref)));
 const allowed=original?.program==='Solar 70'?[...ids,`${key}:advance`,`${key}:completion`]:ids;
 const referenceOwners=sourceRows.filter((r:Row)=>!r.cancelled&&!r.transferred&&(r.customer==='MBL'||String(r.key).startsWith('MBL:')?'Meezan Bank Limited':'United Bank Limited')===bank&&[...(r.invoiceReferences??[]),...(r.verifiedInvoiceReferences??[])].some((ref:string)=>refs.some(r=>r===ref||invoiceIdentity(r)&&invoiceIdentity(r)===invoiceIdentity(ref))));
 if(referenceOwners.some((r:Row)=>r.key!==key)||linked.some(r=>!allowed.includes(r.id)))return {held:true as const,key,customer:bank,billingIds:[]};
 return {held:false as const,key,customer:bank,billingIds:[...new Set(ids)]};
}
