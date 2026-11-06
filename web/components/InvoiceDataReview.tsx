import './site-documents.css';
import {useState} from 'react';
import {Button} from '../ui/Button.js';
import {FinancialValue} from '../ui/FinancialValue.js';
import {invoiceDataReview} from '../../shared/accounts-invoice-review.js';
import {invoiceType} from '../../shared/accounts-invoice-display.js';

type Row=Record<string,any>;
/** Uncertain payment allocation must be confirmed from PT; otherwise a blank balance
 * keeps the known balance, uses recorded receipts, or (no payment anywhere) equals the amount. */
export const outstandingRequired=(row:Row)=>(row.receiptVersion??0)===0&&(!!row.invoiceAllocationPending||row.unallocatedStagePending!=null||row.pending==null&&row.receiptConfirmed===true);
export const amountOutstandingLabel=(row:Row)=>outstandingRequired(row)?'Current outstanding from PT · PKR (required)':'Current outstanding from PT · PKR (optional)';
export function amountBalanceNote(row:Row){
 if((row.receiptVersion??0)>0)return 'Payments are recorded against this invoice, so its outstanding balance stays as calculated from those payments.';
 if(outstandingRequired(row))return 'A payment on this invoice cannot be matched automatically. Enter the outstanding balance shown in PT.';
 if(row.pending!=null)return 'Leave the outstanding blank to keep the existing balance.';
 return 'No payment is recorded for this invoice. If the outstanding is left blank it equals the invoice amount.';
}
const date=(v?:string|null)=>/^\d{4}-\d{2}-\d{2}$/.test(v??'')?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(v+'T00:00:00Z')):'Not recorded';

/** Existing invoice records that still need amounts or allocation checks, recounted live. */
export function InvoiceDataReview({rows,canRecord,onConfirm}:{rows:Row[];canRecord:boolean;onConfirm:(row:Row)=>void}){
 const review=invoiceDataReview(rows),[open,setOpen]=useState<string|null>(null);
 if(!review.total)return null;
 return <section className="accounts-list-panel"><header className="accounts-panel-heading"><div><h2>Invoice records to confirm</h2><p>Existing invoices with missing amounts or payments that need checking. Counts are taken from the current records.</p></div><span>{review.total} {review.total===1?'invoice':'invoices'}</span></header>
  <div className="pz-table-scroll"><table className="site-documents-table"><thead><tr><th>SR#</th><th>Check</th><th>Invoices</th><th>Action</th></tr></thead><tbody>{review.groups.filter(g=>g.rows.length).map((g,n)=><tr key={g.id}><td>{n+1}</td><td><strong>{g.label}</strong><small>{g.action}</small></td><td>{g.rows.length}</td><td><Button variant="neutral" aria-expanded={open===g.id} onClick={()=>setOpen(open===g.id?null:g.id)}>{open===g.id?'Hide':'Show'}</Button></td></tr>)}</tbody></table></div>
  {open&&(()=>{const g=review.groups.find(x=>x.id===open)!;return <div className="pz-table-scroll"><table className="site-documents-table"><thead><tr><th>SR#</th><th>Invoice / site</th><th>Type</th><th className="accounts-money">Amount · PKR</th><th className="accounts-money">Outstanding · PKR</th><th>Submitted</th><th>Action</th></tr></thead><tbody>{g.rows.map((r,i)=><tr key={r.id}><td>{i+1}</td><td><strong>{r.invoice}</strong><small>{r.site} · {r.customer}</small>{r.receiptHold&&<small className="invoice-flag">{r.receiptHold}</small>}{r.invoiceCorrectionHold&&<small className="invoice-flag">{r.invoiceCorrectionHold}</small>}</td><td>{invoiceType(r)}</td><td className="accounts-money">{r.amount==null?<span className="invoice-flag">Not recorded</span>:<FinancialValue places={2} value={r.amount}/>}</td><td className="accounts-money">{r.pending==null?<span className="invoice-flag">{r.unallocatedStagePending!=null?<>Combined balance <FinancialValue places={2} value={r.unallocatedStagePending}/> to allocate</>:'Not recorded'}</span>:<FinancialValue places={2} value={r.pending}/>}</td><td>{r.submission==='Submitted'?date(r.date):'Not submitted'}</td><td><Button variant="secondary" disabled={!canRecord||!!r.receiptHold||!!r.invoiceCorrectionHold} onClick={()=>onConfirm(r)}>Confirm PT amounts</Button></td></tr>)}</tbody></table></div>;})()}
 </section>;
}
