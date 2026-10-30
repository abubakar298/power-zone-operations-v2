import type {Pool,PoolClient}from'pg';
import{Decimal}from'decimal.js';
import{invoiceIdentity}from'./billing-model.js';
type Row=Record<string,any>;
export async function invoiceReceipts(db:Pool|PoolClient){return(await db.query('SELECT *,amount::text AS amount,baseline_pending::text AS baseline_pending,payment_date::text AS payment_date FROM accounts_invoice_receipts ORDER BY created_at,id')).rows;}
export const receiptLedgerKey=(row:Row)=>row.submissionId?'submission:'+row.submissionId+':invoice:'+row.invoice:'row:'+row.id;
/** Reporting projection only: never rewrite imported invoice/receipt/source snapshots. */
export function applyInvoiceReceipts(rows:Row[],events:Row[]):Row[]{return rows.map(row=>{
 const matching=events.filter(e=>e.ledger_key===receiptLedgerKey(row)||e.submission_id&&e.submission_id===row.submissionId&&e.invoice_reference===row.invoice);
 if(!matching.length)return {...row,receiptVersion:0};
 const first=matching[0],sameReference=matching.every(e=>e.invoice_reference===row.invoice&&e.customer===row.customer),sameBalance=row.pending==null?first.snapshot.originalPending==null:first.snapshot.originalPending!=null&&new Decimal(row.pending).eq(first.snapshot.originalPending);
 if(!sameReference||!sameBalance)return {...row,receiptVersion:matching.length,receiptHold:'The source invoice reference or balance changed after recorded receipts. Accounts must reconcile the source before recording more payments.'};
 const received=matching.reduce<Decimal>((n,e)=>n.plus(e.amount),new Decimal(0)),pending=new Decimal(first.baseline_pending).minus(received);
 if(pending.lt(0))return {...row,receiptVersion:matching.length,receiptHold:'Recorded receipts exceed their frozen opening balance; Accounts review required.'};
 return {...row,pending:pending.toFixed(2),receiptConfirmed:pending.isZero(),receiptVersion:matching.length,operationalReceived:received.toFixed(2),receiptSourceKey:first.snapshot.sourceKey??null,receiptMilestone:first.snapshot.milestone??null,lastPaymentDate:matching.at(-1)!.payment_date};
});}
export function awaitingInvoicePayments(rows:Row[],legacyPending:Row[]){const held=new Set(legacyPending.map(r=>r.id));return rows.filter(r=>r.submission==='Submitted'&&!held.has(r.id)&&!!r.invoice&&(!!r.receiptHold||(r.pending==null?r.receiptConfirmed!==true:new Decimal(r.pending).gt(0))));}
/** Keep exact linked programme phases in step with actual receipts; ambiguous
 * historical references are never guessed from a site name. */
export function applyReceiptProgramme(snapshot:Row,rows:Row[]):Row{
 return {...snapshot,registers:(snapshot.registers??[]).map((r:Row)=>({...r,rows:(r.rows??[]).map((site:Row)=>{
  const paid=rows.filter(row=>row.receiptSourceKey===site.key&&row.operationalReceived&&!row.receiptHold);if(!paid.length)return site;
  let result={...site};for(const row of paid){
   if(site.program==='Solar 70'){const phase=row.receiptMilestone==='delivery'?'advance':'completion';result[phase]={...result[phase],outstandingAmount:row.pending,received:new Decimal(row.pending).isZero(),receivedAmount:row.amount==null?row.operationalReceived:new Decimal(row.amount).minus(row.pending).toFixed(2)};}
   else if(site.kind==='UPS'){
    const references=new Set((site.invoiceReferences??[]).map(invoiceIdentity).filter(Boolean)),customer=site.customer==='MBL'?'Meezan Bank Limited':'United Bank Limited';
    const related=rows.filter(r=>r.receiptSourceKey===site.key||r.customer===customer&&r.category==='System'&&r.id==='system:'+customer+':'+invoiceIdentity(r.invoice)&&references.has(invoiceIdentity(r.invoice)));
    if(related.some(r=>r.pending==null||r.receiptHold)||references.size>1&&[...references].some(ref=>!related.some(r=>invoiceIdentity(r.invoice)===ref)))continue;
    const balance=related.reduce<Decimal>((n,r)=>n.plus(r.pending),new Decimal(0)),received=related.reduce<Decimal>((n,r)=>n.plus(r.amount==null?r.operationalReceived??'0':new Decimal(r.amount).minus(r.pending)),new Decimal(0));
    result={...result,singlePaymentReceived:balance.isZero(),operationalOutstanding:balance.toFixed(2),operationalReceivedAmount:received.toFixed(2),receiptsUnverified:false};
   }
  }return result;
 })}))};
}
