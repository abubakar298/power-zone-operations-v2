import {unallocatedInvoiceValue} from '../../server/accounts/billing-model.js';
import {FinancialValue} from '../ui/FinancialValue.js';
import '../ui/accounts-invoice-filters.css';
/** Sum the entire filtered result, before pagination. Missing values stay explicit. */
export function FilteredInvoiceTotal({rows,field,label}:{rows:Record<string,any>[];field:'amount'|'pending';label:string}){
 const known=rows.filter(r=>r[field]!=null&&r[field]!==''),missing=rows.length-known.length;
 const total=known.reduce((n,r)=>n.plus(r[field]),unallocatedInvoiceValue(rows,field));
 const hasValue=known.length>0||!total.isZero()||rows.length===0;
 return <div className="accounts-filtered-total" role="status" aria-label="Filtered invoice total"><span>{missing?'Known '+label.toLowerCase():label} · PKR</span><strong>{hasValue?<FinancialValue value={total.toFixed(2)}/>: 'Not recorded'}</strong>{missing>0&&<small>{missing} {missing===1?'amount':'amounts'} not recorded</small>}{rows.some(r=>r.minimum)&&<small>Includes known minimum amounts</small>}</div>;
}
/** Only the selected milestone's recorded invoice value; never a contract or PO total. */
export function submissionAmount(row:Record<string,any>){
 if(row.amount!=null)return row.amount;
 if(row.program==='Solar 70')return row[row.milestone==='delivery'||row.milestone==='advance'?'advance':'completion']?.invoiceAmount??null;
 return row.actualInvoiceAmount??row.invoiceAmount??null;
}
