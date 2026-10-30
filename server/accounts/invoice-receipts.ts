import type{Pool}from'pg';
import{z}from'zod';
import{Decimal}from'decimal.js';
import{randomUUID}from'node:crypto';
import{transaction}from'../db/transaction.js';
import{lockActiveActor}from'../auth/actor-lock.js';
import{AccountsRepository}from'./repository.js';
import{HttpError}from'../http/errors.js';
import{paymentRegisterData}from'./payment-records.js';
import{receiptLedgerKey}from'./invoice-receipt-state.js';
import{invoiceIdentity}from'./billing-model.js';
const money=z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/).refine(v=>new Decimal(v).gt(0),'Enter a positive PKR amount.');
export const invoiceReceiptSchema=z.object({sourceRowId:z.string().min(1).max(500),sourceVersion:z.number().int().nonnegative(),receiptVersion:z.number().int().nonnegative(),amount:money,outstandingBefore:money.optional(),paymentDate:z.iso.date(),transactionId:z.string().trim().min(1).max(200),requestKey:z.uuid()}).strict();
export async function recordInvoiceReceipt(pool:Pool,actor:string,raw:unknown,now=new Date()){
 const input=invoiceReceiptSchema.parse(raw),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(input.paymentDate>today)throw new HttpError(422,'Actual payment date cannot be in the future.');
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);if(!['Admin','Accounts'].includes(await new AccountsRepository(pool).access(actor,c)))throw new HttpError(403,'Accounts receipt recording access required.');
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('accounts.source-register',0))");
  const replay=(await c.query('SELECT *,amount::text AS amount,payment_date::text AS payment_date FROM accounts_invoice_receipts WHERE request_key=$1',[input.requestKey])).rows[0];
  if(replay){if(replay.created_by===actor&&Object.entries(input).every(([k,v])=>replay.request[k]===v))return replay;throw new HttpError(409,'This request key belongs to a different payment.');}
  const register=await paymentRegisterData(c),row=register.awaiting.find(r=>r.id===input.sourceRowId);
  if(!row||register.sourceVersion!==input.sourceVersion||row.receiptVersion!==input.receiptVersion)throw new HttpError(409,'The invoice balance or payment records changed. Refresh before saving.');
  if(row.receiptHold)throw new HttpError(409,row.receiptHold);
  if(row.pending!=null&&input.outstandingBefore!==undefined)throw new HttpError(422,'Keep the existing outstanding balance unchanged; enter only the amount received.');
  if(row.pending==null&&!input.outstandingBefore)throw new HttpError(422,'Confirm the current outstanding balance from PT before recording the first payment.');
  const outstanding=new Decimal(row.pending??input.outstandingBefore!),amount=new Decimal(input.amount);
  if(row.amount!=null&&outstanding.gt(row.amount))throw new HttpError(422,'Confirmed outstanding balance exceeds the saved invoice amount. Accounts review required.');
  if(amount.gt(outstanding))throw new HttpError(422,'Amount received exceeds this invoice’s outstanding balance. Do not allocate excess or advance money to this invoice.');
  const ledgerKey=receiptLedgerKey(row);
  if((await c.query('SELECT 1 FROM accounts_invoice_receipts WHERE ledger_key=$1 AND lower(btrim(transaction_id))=lower(btrim($2))',[ledgerKey,input.transactionId])).rowCount)throw new HttpError(409,'This payment reference is already recorded against this invoice.');
  const previous=(await c.query('SELECT baseline_pending::text AS baseline_pending,snapshot FROM accounts_invoice_receipts WHERE ledger_key=$1 ORDER BY created_at,id LIMIT 1',[ledgerKey])).rows[0];
  const source=(await c.query('SELECT snapshot FROM accounts_source_registers ORDER BY version DESC LIMIT 1')).rows[0];
  const submission=row.submissionId?(await c.query('SELECT source_key,milestone FROM accounts_invoice_submissions WHERE id=$1',[row.submissionId])).rows[0]:null;
  let sourceKey=submission?.source_key??null,milestone=submission?.milestone??null;
  if(!sourceKey){const hits=(source?.snapshot.registers??[]).flatMap((r:any)=>r.rows??[]).filter((r:any)=>!r.cancelled&&!r.transferred&&((r.program==='Solar 70'&&[r.key+':advance',r.key+':completion'].includes(row.id))||(r.kind==='UPS'&&row.category==='System'&&row.customer===(r.customer==='MBL'?'Meezan Bank Limited':'United Bank Limited')&&(r.invoiceReferences??[]).some((v:string)=>row.id==='system:'+row.customer+':'+invoiceIdentity(v)))));if(hits.length===1){sourceKey=hits[0].key;milestone=row.id.endsWith(':advance')?'delivery':'completion';}}
  const snapshot={invoice:row.invoice,site:row.site,ipo:row.ipo,customer:row.customer,sourceKey,milestone,originalPending:previous?previous.snapshot.originalPending:row.pending,invoiceAmount:row.amount,balanceBefore:outstanding.toFixed(2),balanceAfter:outstanding.minus(amount).toFixed(2),submissionDate:row.date};
  const saved=(await c.query('INSERT INTO accounts_invoice_receipts(id,ledger_key,source_row_id,submission_id,source_version,invoice_reference,customer,amount,baseline_pending,payment_date,transaction_id,snapshot,request,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *,amount::text AS amount,payment_date::text AS payment_date',[randomUUID(),ledgerKey,row.id,row.submissionId??null,input.sourceVersion,row.invoice,row.customer,amount.toFixed(2),previous?.baseline_pending??outstanding.toFixed(2),input.paymentDate,input.transactionId,snapshot,input,input.requestKey,actor])).rows[0];
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'accounts.invoice-receipt:'+saved.id]);return saved;
 });
}
