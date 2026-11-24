import {useEffect,useState} from 'react';
import {api} from '../api.js';
import {AccountsRecordDialog} from './AccountsRecordDialog.js';
import {InvoiceRecords} from './InvoiceRecords.js';
import {confirmLeaveWorkspace,useUnsavedChanges} from '../hooks/useUnsavedChanges.js';
import {FinancialValue} from '../ui/FinancialValue.js';

/** Awaiting payment lists invoices. This opens the site behind one submitted invoice
 * with the same invoice panel as Invoices to Submit, so Accounts can add an extra
 * invoice there. Saving uses the same route and checks; no payment is changed. */
/** cableInvoices: this site's extra-cable invoices (same customer + IPO), shown read-only so the whole site is in one window. */
export function ExtraInvoiceDialog({invoice,canRecord,cableInvoices=[],onClose,onSaved}:{invoice:any;canRecord:boolean;cableInvoices?:any[];onClose:()=>void;onSaved:(message:string)=>Promise<void>|void}){
 const [site,setSite]=useState<any>(),[error,setError]=useState(''),[dirty,setDirty]=useState(false);
 useUnsavedChanges(dirty);
 const load=()=>api<any>('/accounts-workspace/payment-row-site?'+new URLSearchParams({id:String(invoice.id)}).toString());
 useEffect(()=>{let active=true;load().then(s=>{if(active)setSite(s);}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[invoice.id]);
 async function saved(message:string){setDirty(false);try{setSite(await load());}catch{}await onSaved(message);}
 return <AccountsRecordDialog title={site?.site??invoice.site} reference={site?.ipo??invoice.ipo} subtitle="Add extra invoice" wide onClose={()=>{if(dirty&&!confirmLeaveWorkspace())return;onClose();}}>
  {error?<p role="alert" className="form-error">{error}</p>:!site?<p role="status">Loading site invoices…</p>:<InvoiceRecords row={site} canRecord={canRecord} onDirty={setDirty} onSaved={saved}/>}
  {cableInvoices.length>0&&<section className="accounts-record-section"><h3>Extra cable invoices for this site</h3><p className="pz-caption">Shown for reference. Record payments for these from their own rows in Payments to Record.</p><div className="pz-table-scroll"><table><thead><tr><th>SR#</th><th>Invoice</th><th>Invoice amount · PKR</th><th>Outstanding · PKR</th><th>Status</th></tr></thead><tbody>{cableInvoices.map((r:any,i:number)=><tr key={r.id} style={{verticalAlign:'top'}}><td>{i+1}</td><td><strong>{r.invoice}</strong></td><td>{r.amount==null?'Confirm from PT':<FinancialValue places={0} value={r.amount}/>}</td><td>{r.pending==null?'Confirm from PT':<FinancialValue places={0} value={r.pending}/>}</td><td>{r.receiptConfirmed||r.pending==='0.00'?'Paid':r.submission==='Submitted'?'Submitted '+(r.date||'—'):r.submission||'Not submitted'}</td></tr>)}</tbody></table></div></section>}
 </AccountsRecordDialog>;
}
