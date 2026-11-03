import {Decimal} from 'decimal.js';
import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {lockActiveActor} from '../auth/actor-lock.js';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';
import {AccountsRepository} from './repository.js';
type Db=Pool|PoolClient;
type Row=Record<string,any>;
export const invoiceStages=['advance-delivery','balance-completion','delivery-only','extra-cable','internet'] as const;
export const invoiceStageLabels:Record<(typeof invoiceStages)[number],string>={'advance-delivery':'Advance / delivery','balance-completion':'Balance / completion','delivery-only':'Delivery only','extra-cable':'Extra cable','internet':'Internet'};
export const delayReasons=['qc-pictures','physical-originals','customer-clarification','other'] as const;
export const delayReasonLabels:Record<(typeof delayReasons)[number],string>={'qc-pictures':'Awaiting QC pictures','physical-originals':'Awaiting physical originals','customer-clarification':'Customer clarification','other':'Other'};
export const invoiceMoney=z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/).refine(v=>new Decimal(v).gt(0),'Enter a positive PKR amount.');
/** Exact printed number: 27-10609 and 27-10609-S are different invoices. */
export const normalizedInvoiceReference=(value:unknown)=>String(value??'').trim().replace(/\s+/g,' ').toLowerCase();
/** Historical rows may hold several numbers in one field; compare each one. */
export const invoiceReferenceParts=(value:unknown)=>String(value??'').split(/\s+\/\s+|,\s*|\s*&\s*/).map(normalizedInvoiceReference).filter(Boolean);
export const entryInvoiceKey=(id:string)=>'entry:'+id;
export const siteInvoiceKey=(row:Row)=>`site:${row.sourceKind}:${row.key}:${row.milestone}`;
export function defaultInvoiceStage(row:Row):(typeof invoiceStages)[number]{
 return row.billingStage==='delivery-only'?'delivery-only':row.milestone==='delivery'?'advance-delivery':'balance-completion';
}
export async function latestInvoiceUpdates(c:Db){
 return (await c.query('SELECT DISTINCT ON(invoice_key) *,amount::text AS amount FROM accounts_invoice_updates ORDER BY invoice_key,version DESC')).rows;
}
/** Current amount and delay of one saved invoice. A missing amount stays null and is
 * flagged; it is never filled from BOQ, milestone or outstanding values. */
export function invoiceState(entry:Row,updates:Row[]){
 const update=updates.find(u=>u.invoice_key===entryInvoiceKey(entry.id));
 const amount=update?update.amount:entry.amount==null?null:new Decimal(entry.amount).toFixed(2);
 return {amount:amount==null?null:new Decimal(amount).toFixed(2),updateVersion:update?.version??0,delay:update?.delay_reason?{reason:update.delay_reason,label:delayReasonLabels[update.delay_reason as keyof typeof delayReasonLabels],note:update.delay_note}:null};
}

export const invoiceUpdateSchema=z.object({invoiceKey:z.string().min(1).max(500),version:z.number().int().nonnegative(),amount:invoiceMoney.optional(),delayReason:z.enum(delayReasons).nullable().optional(),delayNote:z.string().trim().max(2000).optional(),reason:z.string().trim().max(2000).default(''),requestKey:z.uuid()}).strict()
 .refine(v=>v.amount!==undefined||v.delayReason!==undefined,'Enter an amount or a delay reason.')
 .refine(v=>v.delayReason!=='other'||!!v.delayNote?.trim(),{message:'Add a note explaining the other delay reason.',path:['delayNote']});
/** Amount entry/correction and submission-delay reasons. Never records a payment. */
export async function recordInvoiceUpdate(pool:Pool,actor:string,raw:unknown){
 const input=invoiceUpdateSchema.parse(raw);
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);
  if(!['Admin','Accounts'].includes(await new AccountsRepository(pool).access(actor,c)))throw new HttpError(403,'Accounts invoice recording access required.');
  await c.query("SELECT pg_advisory_xact_lock(hashtext('accounts.invoice-register'))");
  const replay=(await c.query('SELECT *,amount::text AS amount FROM accounts_invoice_updates WHERE request_key=$1',[input.requestKey])).rows[0];
  if(replay){if(replay.created_by===actor&&Object.entries(input).every(([k,v])=>replay.request[k]===v))return replay;throw new HttpError(409,'Request key already used.');}
  const latest=(await c.query('SELECT *,amount::text AS amount FROM accounts_invoice_updates WHERE invoice_key=$1 ORDER BY version DESC LIMIT 1',[input.invoiceKey])).rows[0];
  if((latest?.version??0)!==input.version)throw new HttpError(409,'This invoice was updated. Refresh before saving.');
  const entryId=/^entry:([0-9a-f-]{36})$/.exec(input.invoiceKey)?.[1];
  let currentAmount:string|null=null,snapshot:Row;
  if(entryId){
   const entry=(await c.query('SELECT *,amount::text AS amount,entry_date::text AS entry_date FROM accounts_invoice_entries WHERE id=$1',[entryId])).rows[0];
   if(!entry)throw new HttpError(404,'Invoice record not found.');
   currentAmount=invoiceState(entry,latest?[latest]:[]).amount;
   const submission=(await c.query('SELECT id FROM accounts_invoice_submissions WHERE invoice_entry_id=$1',[entryId])).rows[0];
   if(input.amount!==undefined&&submission&&(await c.query('SELECT 1 FROM accounts_invoice_receipts WHERE submission_id=$1 LIMIT 1',[submission.id])).rowCount)
    throw new HttpError(409,'This invoice has recorded payments. Reconcile those payment records before changing its amount.');
   if(input.delayReason&&submission)throw new HttpError(409,'This invoice is already submitted; no delay reason is needed.');
   snapshot={entryId,reference:entry.pt_reference,site:entry.snapshot.site,ipo:entry.snapshot.ipo,milestone:entry.milestone,submitted:!!submission};
  }else if(/^site:/.test(input.invoiceKey)){
   if(input.amount!==undefined)throw new HttpError(422,'Record the amount on the PT invoice record itself.');
   snapshot={invoiceKey:input.invoiceKey};
  }else throw new HttpError(404,'Invoice record not found.');
  const amount=input.amount!==undefined?new Decimal(input.amount).toFixed(2):currentAmount;
  const correcting=input.amount!==undefined&&currentAmount!==null&&!new Decimal(currentAmount).eq(input.amount);
  if(correcting&&!input.reason)throw new HttpError(422,'Give a reason for correcting the invoice amount.');
  const delayReason=input.delayReason!==undefined?input.delayReason:latest?.delay_reason??null;
  const delayNote=input.delayReason!==undefined?(input.delayNote??''):latest?.delay_note??'';
  const reason=input.reason||(input.amount!==undefined&&currentAmount===null?'Invoice amount entered':input.amount!==undefined?'Invoice amount confirmed':delayReason?'Submission delay reason recorded':'Submission delay reason cleared');
  const saved=(await c.query('INSERT INTO accounts_invoice_updates(id,invoice_key,version,amount,delay_reason,delay_note,reason,snapshot,request,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *,amount::text AS amount',[randomUUID(),input.invoiceKey,input.version+1,amount,delayReason,delayNote,reason,{...snapshot,previousAmount:currentAmount,previousDelay:latest?.delay_reason??null},input,input.requestKey,actor])).rows[0];
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'accounts.invoice-update:'+saved.id]);
  return saved;
 });
}
