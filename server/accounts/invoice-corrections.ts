import {Decimal} from 'decimal.js';
import type{Pool}from'pg';import{randomUUID}from'node:crypto';import{z}from'zod';
import{transaction}from'../db/transaction.js';import{lockActiveActor}from'../auth/actor-lock.js';import{AccountsRepository}from'./repository.js';import{HttpError}from'../http/errors.js';import{paymentRegisterData}from'./payment-records.js';import{invoiceType}from'../../shared/accounts-invoice-display.js';import{receiptLedgerKey}from'./invoice-receipt-state.js';import{pkrDigits}from'./invoice-records.js';
type Row=Record<string,any>;
/** How an amount-only entry treats the balance. Known balances and recorded
 * receipts are kept; an uncertain payment is never allocated silently. */
export function amountRule(row:Row,outstandingGiven:boolean):{rule:'confirmed'|'kept'|'from-receipts'|'no-payments';hold?:string;minimum?:string}{
 if(row.receiptHold)return {rule:'kept',hold:row.receiptHold};
 const received=new Decimal(row.operationalReceived??0);
 if((row.receiptVersion??0)>0)return {rule:'from-receipts',minimum:received.plus(row.pending??0).toFixed(2)};
 if(outstandingGiven)return {rule:'confirmed'};
 if(row.invoiceAllocationPending||row.unallocatedStagePending!=null)return {rule:'kept',hold:'A payment or balance on the combined invoice still needs allocation to the separate invoices. Enter this invoice’s current outstanding balance from PT together with its amount; nothing is divided automatically.'};
 if(row.pending!=null)return {rule:'kept',minimum:new Decimal(row.pending).toFixed(2)};
 if(row.receiptConfirmed===true)return {rule:'kept',hold:'The reviewed register shows a receipt for this invoice. Enter its current outstanding balance from PT together with the amount.'};
 return {rule:'no-payments'};
}
export const invoiceCorrectionSchema=z.object({sourceRowId:z.string().min(1).max(500),sourceVersion:z.number().int().positive(),version:z.number().int().nonnegative(),invoiceReference:z.string().trim().min(1).max(200).refine(v=>!(/\s+\/\s+|,|\s*&\s*/.test(v)),'Enter one invoice number per record.'),submissionDate:z.iso.date().nullable(),reason:z.string().trim().min(1).max(2000),confirmedAmount:pkrDigits.optional(),confirmedOutstanding:pkrDigits.optional(),requestKey:z.uuid()}).strict();
export async function correctInvoice(pool:Pool,actor:string,raw:unknown,now=new Date()){
 const input=invoiceCorrectionSchema.parse(raw),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const confirmingAmount=input.confirmedAmount!==undefined||input.confirmedOutstanding!==undefined;
 // A PT outstanding balance may also be saved on its own when no payment has been received
 // (Record Payment with amount received 0): no payment and no invoice amount are inferred.
 const outstandingOnly=input.confirmedAmount===undefined&&input.confirmedOutstanding!==undefined;
 if(outstandingOnly&&!new Decimal(input.confirmedOutstanding!).gt(0))throw new HttpError(422,'Enter the current outstanding balance from PT.');
 // The outstanding balance may be confirmed with the amount, or left to the rule below.
 if(confirmingAmount&&!outstandingOnly&&(!input.confirmedAmount||!new Decimal(input.confirmedAmount).gt(0)||input.confirmedOutstanding!==undefined&&new Decimal(input.confirmedOutstanding).gt(input.confirmedAmount)))throw new HttpError(422,'Enter the positive invoice amount from PT. Outstanding cannot exceed the invoice amount.');
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
  const paid=(row.receiptVersion??0)>0,rule=amountRule(row,input.confirmedOutstanding!==undefined);
  if(confirmingAmount&&paid&&input.confirmedOutstanding!==undefined)throw new HttpError(409,'This invoice has recorded payments. Its outstanding balance comes from those payments; enter only the invoice amount.');
  if(confirmingAmount&&rule.hold)throw new HttpError(409,rule.hold);
  if(outstandingOnly&&row.amount!=null&&new Decimal(input.confirmedOutstanding!).gt(row.amount))throw new HttpError(422,`The outstanding balance cannot exceed the invoice amount of ${new Decimal(row.amount).toFixed(2)}. Check the balance in PT.`);
  if(confirmingAmount&&!outstandingOnly&&rule.minimum&&new Decimal(input.confirmedAmount!).lt(rule.minimum))throw new HttpError(422,`The invoice amount cannot be less than ${rule.minimum} (payments recorded plus the outstanding balance). Check the amount in PT.`);
  // Before receipts the invoice's own pending value is the first receipt's frozen opening balance.
  const firstReceipt=paid?register.receipts.find((e:any)=>e.ledger_key===receiptLedgerKey(row)):undefined;
  if(!confirmingAmount&&input.invoiceReference===row.invoice&&input.submissionDate===(row.date??null))throw new HttpError(422,'Change the invoice number or submission date before saving.');
  const snapshot={originalInvoice:row.originalInvoice??row.invoice,customer:row.customer,site:row.site,invoiceType:invoiceType(row),previousInvoice:row.invoice,previousDate:row.date??null,...(confirmingAmount?{...input.confirmedAmount!==undefined?{confirmedAmount:new Decimal(input.confirmedAmount).toFixed(2)}:{},...input.confirmedOutstanding!==undefined?{confirmedOutstanding:new Decimal(input.confirmedOutstanding).toFixed(2)}:{},outstandingRule:rule.rule,sourceAmount:Object.hasOwn(row,'originalAmount')?row.originalAmount:row.amount,sourcePending:firstReceipt?firstReceipt.snapshot.originalPending??null:Object.hasOwn(row,'originalPending')?row.originalPending:row.pending,...paid?{receivedBefore:row.operationalReceived??null}:{}}:{})};
  const saved=(await c.query('INSERT INTO accounts_invoice_corrections(id,source_row_id,source_version,version,invoice_reference,submitted_on,reason,snapshot,request,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[randomUUID(),row.id,input.sourceVersion,input.version+1,input.invoiceReference,input.submissionDate,input.reason,snapshot,input,input.requestKey,actor])).rows[0];
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'accounts.invoice-correction:'+saved.id]);return saved;
 });
}
