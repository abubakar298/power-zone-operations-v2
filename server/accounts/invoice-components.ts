import {Decimal} from 'decimal.js';
import {applyInvoiceCorrections} from './invoice-correction-state.js';
import {applyInvoiceReceipts} from './invoice-receipt-state.js';
type Row=Record<string,any>;
/** Exact source-key + milestone + printed invoice identity. Existing aggregate
 * ledger events are projected first and retained; they are never reposted. */
export function separateInvoiceRows(rows:Row[],components:Row[]=[]):Row[]{
 return rows.flatMap(row=>{
  const stage=row.category==='System · advance'?'advance':row.category==='System · completion'?'completion':undefined;
  let parts=stage?components.filter(c=>c.sourceKey===row.id.slice(0,-stage.length-1)&&c.stage===stage):[];
  if(!parts.length){const refs=[...new Set(String(row.invoice??'').split(/\s+\/\s+|,\s*|\s*&\s*|\s+(?=\d{2}-\d{4,}(?:-S)?(?:-\d+\/\d+)?(?:\s|$))/).map(v=>v.trim()).filter(Boolean))];if(refs.length<2)return [row];parts=refs.map(invoice=>({sourceKey:row.sourceKey,invoice,amount:null}));}
  if(new Set(parts.map(p=>p.invoice)).size!==parts.length)throw Error('Duplicate invoice component identity.');
  const fullOutstanding=row.pending!=null&&row.amount!=null&&new Decimal(row.pending).eq(row.amount)&&!row.operationalReceived;
  return parts.map(part=>{
   const pending=row.receiptHold||row.invoiceCorrectionHold?null:part.pending!=null?new Decimal(part.pending).toFixed(2):row.pending!=null&&new Decimal(row.pending).isZero()?'0.00':fullOutstanding&&part.amount!=null?new Decimal(part.amount).toFixed(2):null;
   const held=pending===null&&row.pending!=null&&new Decimal(row.pending).gt(0);
   return {...row,id:`${row.id}:invoice:${part.invoice}`,legacyStageId:row.id,sourceKey:part.sourceKey,billingMilestone:stage?(stage==='advance'?'delivery':'completion'):row.billingMilestone,invoice:part.invoice,originalInvoice:undefined,invoiceReferenceAliases:undefined,submissionId:undefined,amount:part.amount==null?null:new Decimal(part.amount).toFixed(2),pending,receiptConfirmed:pending==='0.00'&&row.receiptConfirmed===true,receiptVersion:0,correctionVersion:0,correctionHistory:[],receiptHold:row.receiptHold,invoiceCorrectionHold:row.invoiceCorrectionHold,operationalReceived:undefined,receiptSourceKey:undefined,receiptMilestone:undefined,date:row.submission==='Submitted'?(part.submittedOn??row.date):null,invoiceComponentSource:part.source,unallocatedStageAmount:part.amount==null?row.amount:null,invoiceAllocationPending:held,unallocatedStagePending:held?row.pending:null,notes:[row.notes,held?`Stage balance ${row.pending} needs allocation to individual invoices in PT. No payment was divided automatically.`:'',part.notes].filter(Boolean).join(' ')};
  });
 });
}
/** New invoice-specific corrections and payments apply only after separation.
 * Legacy entries already applied to the stage must not be deducted twice. */
export function applySeparatedInvoiceEvents(rows:Row[],components:Row[],corrections:Row[],receipts:Row[]):Row[]{
 return separateInvoiceRows(rows,components).map(row=>{if(!row.legacyStageId)return row;const next=applyInvoiceReceipts(applyInvoiceCorrections([row],corrections),receipts)[0];return {...next,invoiceAllocationPending:next.pending==null&&row.invoiceAllocationPending};});
}
