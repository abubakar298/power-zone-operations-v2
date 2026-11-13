import {useEffect,useState} from 'react';
import {api} from '../api.js';
import {AccountsRecordDialog} from './AccountsRecordDialog.js';
import {InvoiceRecords} from './InvoiceRecords.js';
import {confirmLeaveWorkspace,useUnsavedChanges} from '../hooks/useUnsavedChanges.js';

/** Awaiting payment lists invoices. This opens the site behind one submitted invoice
 * with the same invoice panel as Invoices to Submit, so Accounts can add an extra
 * invoice there. Saving uses the same route and checks; no payment is changed. */
export function ExtraInvoiceDialog({invoice,canRecord,onClose,onSaved}:{invoice:any;canRecord:boolean;onClose:()=>void;onSaved:(message:string)=>Promise<void>|void}){
 const [site,setSite]=useState<any>(),[error,setError]=useState(''),[dirty,setDirty]=useState(false);
 useUnsavedChanges(dirty);
 const load=()=>api<any>(`/accounts-workspace/invoice-submissions/${encodeURIComponent(invoice.submissionId)}/site`);
 useEffect(()=>{let active=true;load().then(s=>{if(active)setSite(s);}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[invoice.submissionId]);
 async function saved(message:string){setDirty(false);try{setSite(await load());}catch{}await onSaved(message);}
 return <AccountsRecordDialog title={site?.site??invoice.site} reference={site?.ipo??invoice.ipo} subtitle="Add extra invoice" wide onClose={()=>{if(dirty&&!confirmLeaveWorkspace())return;onClose();}}>
  {error?<p role="alert" className="form-error">{error}</p>:!site?<p role="status">Loading site invoices…</p>:<InvoiceRecords row={site} canRecord={canRecord} onDirty={setDirty} onSaved={saved}/>}
 </AccountsRecordDialog>;
}
