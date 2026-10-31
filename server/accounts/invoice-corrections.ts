import {Decimal} from 'decimal.js';
import type{Pool}from'pg';import{randomUUID}from'node:crypto';import{z}from'zod';
import{transaction}from'../db/transaction.js';import{lockActiveActor}from'../auth/actor-lock.js';import{AccountsRepository}from'./repository.js';import{HttpError}from'../http/errors.js';import{paymentRegisterData}from'./payment-records.js';import{invoiceType}from'../../shared/accounts-invoice-display.js';
export const invoiceCorrectionSchema=z.object({sourceRowId:z.string().min(1).max(500),sourceVersion:z.number().int().positive(),version:z.number().int().nonnegative(),invoiceReference:z.string().trim().min(1).max(200).refine(v=>!(/\s+\/\s+|,|\s*&\s*/.test(v)),'Enter one invoice number per record.'),submissionDate:z.iso.date().nullable(),reason:z.string().trim().min(1).max(2000),confirmedAmount:z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/).optional(),confirmedOutstanding:z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/).optional(),requestKey:z.uuid()}).strict();
export async function correctInvoice(pool:Pool,actor:string,raw:unknown,now=new Date()){
 const input=invoiceCorrectionSchema.parse(raw),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const confirmingAmount=input.confirmedAmount!==undefined||input.confirmedOutstanding!==undefined;
 if(confirmingAmount&&(!input.confirmedAmount||input.confirmedOutstanding===undefined||!new Decimal(input.confirmedAmount).gt(0)||new Decimal(input.confirmedOutstanding).gt(input.confirmedAmount)))throw new HttpError(422,'Enter the positive invoice amount and its current outstanding balance from PT. Outstanding cannot exceed the invoice amount.');
 if(input.submissionDate&&input.submissionDate>today)throw new HttpError(422,'Submission date cannot be in the future.');
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);if(!['Admin','Accounts'].includes(await new AccountsRepository(pool).access(actor,c)))throw new HttpError(403,'Accounts invoice editing access required.');
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('accounts.source-register',0))");
  const old=(await c.query('SELECT * FROM accounts_invoice_corrections WHERE request_key=$1',[input.requestKey])).rows[0];
  if(old){if(old.created_by===actor&&Object.entries(input).every(([k,v])=>old.request[k]===v))return old;throw new HttpError(409,'This request key belongs to another correction.');}
  const register=await paymentRegisterData(c),row=register.invoices.find(r=>r.id===input.sourceRowId);
  if(!row||input.sourceVersion!==register.sourceVersion||input.version!==row.correctionVersion)throw new HttpError(409,'The invoice changed. Refresh before editing.');
  if(row.invoiceCorrectionHold)throw new HttpError(409,row.invoiceCorrectionHold);
  const same=(s:string)=>s.trim().replace(/\s+/g,' ').toLowerCase();
  if(register.invoices.some(r=>r.id!==row.id&&r.customer===row.customer&&invoiceType(r)===invoiceType(row)&&same(r.invoice)===same(input.invoiceReference)))throw new HttpError(409,'Another invoice at this stage already uses that number for this customer.');
  if(confirmingAmount&&(row.receiptVersion??0)>0)throw new HttpError(409,'This invoice has recorded payments. Reconcile those payment records before changing its PT balance.');
  if(!confirmingAmount&&input.invoiceReference===row.invoice&&input.submissionDate===(row.date??null))throw new HttpError(422,'Change the invoice number or submission date before saving.');
  const snapshot={originalInvoice:row.originalInvoice??row.invoice,customer:row.customer,site:row.site,invoiceType:invoiceType(row),previousInvoice:row.invoice,previousDate:row.date??null,...(confirmingAmount?{confirmedAmount:new Decimal(input.confirmedAmount!).toFixed(2),confirmedOutstanding:new Decimal(input.confirmedOutstanding!).toFixed(2),sourceAmount:Object.hasOwn(row,'originalAmount')?row.originalAmount:row.amount,sourcePending:Object.hasOwn(row,'originalPending')?row.originalPending:row.pending}:{})};
  const saved=(await c.query('INSERT INTO accounts_invoice_corrections(id,source_row_id,source_version,version,invoice_reference,submitted_on,reason,snapshot,request,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[randomUUID(),row.id,input.sourceVersion,input.version+1,input.invoiceReference,input.submissionDate,input.reason,snapshot,input,input.requestKey,actor])).rows[0];
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'accounts.invoice-correction:'+saved.id]);return saved;
 });
}
