import {isMissingInvoiceCustomer} from './invoice-customer-identity.js';
import type {Pool,PoolClient} from 'pg';
import {invoiceIdentity} from './billing-model.js';
import {Decimal} from 'decimal.js';
type Row=Record<string,any>;
export const submissionKey=(value:unknown)=>String(value??'').replace(/^registered-/,'').replace(/^live-ipo:/,'issued:');
export const submissionMilestone=(value:unknown)=>value==='advance'?'delivery':value;
export const submissionReferences=(values:unknown[])=>[...new Set(values.filter(v=>typeof v==='string'&&v.trim()).map(v=>String(v).trim()))];
export async function invoiceSubmissions(c:Pool|PoolClient){
 // Recover only a missing customer through BOTH exact immutable IPO keys. Shared
 // IPO numbers, invoice text and site names are never customer-link evidence.
 // A separate invoice carries its own current amount (latest Accounts update, else
 // the amount saved with the invoice). Missing stays NULL; nothing is inferred.
 const rows=(await c.query(`SELECT s.*,s.submitted_on::text AS submitted_on,customer.name AS linked_customer_name,ipo.id AS linked_ipo_id,
 entry.invoice_stage AS entry_stage,entry.invoice_label AS entry_label,
 CASE WHEN latest.version IS NOT NULL THEN latest.amount::text ELSE entry.amount::text END AS entry_amount
 FROM accounts_invoice_submissions s
 LEFT JOIN accounts_invoice_entries entry ON entry.id=s.invoice_entry_id
 LEFT JOIN LATERAL(SELECT u.version,u.amount FROM accounts_invoice_updates u WHERE u.invoice_key='entry:'||entry.id::text ORDER BY u.version DESC LIMIT 1) latest ON true
 LEFT JOIN internal_purchase_orders ipo ON s.source_kind='Operations' AND s.source_key='issued:'||ipo.id::text AND s.site_key='live-ipo:'||ipo.id::text
 LEFT JOIN customer_purchase_orders po ON po.id=ipo.customer_po_id
 LEFT JOIN customers customer ON customer.id=po.customer_id
 ORDER BY s.created_at,s.id`)).rows;
 return rows.map(({linked_customer_name,linked_ipo_id,...event})=>linked_customer_name&&isMissingInvoiceCustomer(event.snapshot.customer)?{...event,snapshot:{...event.snapshot,customer:linked_customer_name,customerLink:{basis:'Exact saved IPO customer',ipoId:linked_ipo_id,originalCustomer:event.snapshot.customer??null}}}:event);
}
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
 // A separate invoice links to a reviewed register row only when that row prints
 // the same invoice number; otherwise it is its own receivable with its own amount.
 const separate=(e:Row)=>!!e.invoice_entry_id;
 const sameNumber=(row:Row,e:Row)=>String(row.invoice??'').trim().toLowerCase()===String(e.invoice_reference??'').trim().toLowerCase();
 const links=(e:Row,row:Row)=>(e.snapshot.billingIds??[]).includes(row.id)&&e.snapshot.customer===row.customer&&(!separate(e)||sameNumber(row,e));
 const result=rows.map(row=>{
  const matches=events.filter(e=>links(e,row));
  if(matches.length!==1)return row;
  return {...row,po:row.po||matches[0].snapshot.po||'',sourceKey:matches[0].source_key,billingMilestone:matches[0].milestone,submissionId:matches[0].id,submission:'Submitted',date:matches[0].submitted_on,dateBasis:'Days since verified submission'};
 });
 for(const e of events){
  if(result.some(r=>links(e,r)))continue;
  const stage=e.entry_stage,amount=separate(e)&&e.entry_amount!=null?new Decimal(e.entry_amount).toFixed(2):null;
  // A separate invoice keeps the stage Accounts recorded for it.
  const category=stage==='extra-cable'?'Extra cable':stage==='internet'?'Internet':stage==='advance-delivery'?'System · advance':stage==='delivery-only'?'System · delivery':stage==='balance-completion'?'System · completion':e.milestone==='delivery'?(String(e.source_key).startsWith('UBL:SOLAR:')||(e.snapshot.billingIds??[]).some((id:string)=>id.endsWith(':advance'))?'System · advance':'System · delivery'):'System · completion';
  result.push({id:'submission:'+e.id,sourceKey:e.source_key,billingMilestone:e.milestone,submissionId:e.id,invoiceEntryId:e.invoice_entry_id??null,invoiceLabel:e.entry_label??null,customer:e.snapshot.customer,customerLink:e.snapshot.customerLink,category,ipo:e.snapshot.ipo??'',po:e.snapshot.po??'',site:e.snapshot.site??'',invoice:e.invoice_reference,amount,pending:amount,...amount?{invoiceAmountBasis:'Accounts recorded PT invoice amount',pendingBasis:'Invoice amount; no payment recorded'}:{},receiptConfirmed:false,date:e.submitted_on,dateBasis:'Days since verified submission',submission:'Submitted',notes:amount?'Separate PT invoice submitted with its recorded amount.':separate(e)?'Separate PT invoice submitted. Invoice amount not recorded yet; Accounts must enter it. No amount or payment inferred.':'Existing PT invoice submitted. Original invoice amount and unpaid balance are not loaded; no amounts or payments inferred.',minimum:false,amountMissing:amount==null});
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

