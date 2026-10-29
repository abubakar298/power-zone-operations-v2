import {paymentReviewNote} from '../../shared/accounts-payment-review.js';
import {useEffect,useState} from 'react';
import {api} from '../api.js';
import {Button} from '../ui/Button.js';
import {Field} from '../ui/Field.js';
import {AccountsRecordDialog} from '../components/AccountsRecordDialog.js';
import {useUnsavedChanges,confirmLeaveWorkspace} from '../hooks/useUnsavedChanges.js';

export function AccountsPayments(){
 const[data,setData]=useState<any>(),[error,setError]=useState(''),[search,setSearch]=useState(''),[selected,setSelected]=useState<any>(),[transactionId,setTransactionId]=useState(''),[paymentDate,setPaymentDate]=useState(''),[busy,setBusy]=useState(false),[actionError,setActionError]=useState(''),[success,setSuccess]=useState(''),[requestKey,setRequestKey]=useState('');
 useUnsavedChanges(!!selected&&(!!transactionId||!!paymentDate));
 useEffect(()=>{let active=true;void api('/accounts-workspace/payment-records').then(r=>{if(active)setData(r);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 async function save(){
  if(busy)return;setBusy(true);setActionError('');
  try{
   const session=await api<any>('/auth/session');
   const entry=await api<any>('/accounts-workspace/payment-records',{csrf:session.csrfToken,body:{sourceRowId:selected.id,sourceVersion:data.sourceVersion,transactionId,paymentDate,requestKey}});
   setData({...data,pending:data.pending.filter((r:any)=>r.id!==selected.id),entries:[{...entry,payment_date:paymentDate},...data.entries]});
   setSelected(undefined);setTransactionId('');setPaymentDate('');setSuccess('Payment transaction details recorded.');
  }catch(e){setActionError((e as Error).message);}finally{setBusy(false);}
 }
 if(error)return <p role="alert" className="form-error">{error}</p>;
 if(!data)return <p role="status">Loading payments to record…</p>;
 const rows=data.pending.filter((r:any)=>[r.site,r.ipo,r.invoice,r.customer,paymentReviewNote(r.id,data.sourceVersion)].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
 return <section className="pz-stack">
  {success&&<p role="status">{success}</p>}
  <section className="accounts-list-panel">
   <header className="accounts-panel-heading"><h2>Payments to Record</h2><span>{rows.length} receipts</span></header>
   <p className="pz-caption">Confirmed receipts awaiting transaction ID and payment date. This queue does not include unpaid invoices.</p>
   <div className="accounts-worklist-filters"><Field id="payment-search" label="Search invoice, IPO, site or customer"><input id="payment-search" type="search" value={search} onChange={e=>setSearch(e.target.value)}/></Field><Button variant="neutral" onClick={()=>setSearch('')}>Clear search</Button></div>
   <div className="pz-table-scroll"><table><thead><tr><th>Invoice / site</th><th>Customer</th><th>Receipt evidence</th><th>Next action</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id} style={{verticalAlign:'top'}}><td><strong>{r.invoice}</strong><small>{r.site} · {r.ipo}</small></td><td>{r.customer}<small>{r.category}</small></td><td style={{verticalAlign:'top'}}>{paymentReviewNote(r.id,data.sourceVersion)&&<><strong>Accounts confirmation needed</strong><p className="pz-caption">{paymentReviewNote(r.id,data.sourceVersion)}</p></>}Received<small>{r.notes||'Receipt confirmed in the Accounts source register.'}</small></td><td><Button variant="secondary" disabled={!data.canRecord} onClick={()=>{setSelected(r);setTransactionId('');setPaymentDate('');setActionError('');setRequestKey(crypto.randomUUID());}}>View</Button></td></tr>)}</tbody></table></div>
   {!rows.length&&<p>No confirmed receipts awaiting transaction details{search?' match this search':''}.</p>}
  </section>
  <details className="accounts-list-panel"><summary>Recorded payments · {data.entries.length}</summary><div className="pz-table-scroll"><table><thead><tr><th>Invoice / site</th><th>Transaction ID</th><th>Payment date</th></tr></thead><tbody>{data.entries.map((r:any)=><tr key={r.id}><td><strong>{r.snapshot.invoice}</strong><small>{r.snapshot.site}</small></td><td>{r.transaction_id}</td><td>{r.payment_date}</td></tr>)}</tbody></table></div></details>
  {selected&&<AccountsRecordDialog title="Record Payment" reference={selected.invoice} subtitle={selected.site} onClose={()=>{if(!busy&&confirmLeaveWorkspace())setSelected(undefined);}}><form onSubmit={e=>{e.preventDefault();void save();}}>{paymentReviewNote(selected.id,data.sourceVersion)&&<section className="accounts-record-section"><h3>What needs checking</h3><p>{paymentReviewNote(selected.id,data.sourceVersion)}</p></section>}<div className="pz-form-grid"><Field id="payment-transaction-id" label="Transaction ID"><input id="payment-transaction-id" required maxLength={200} value={transactionId} disabled={busy} onChange={e=>setTransactionId(e.target.value)}/></Field><Field id="payment-date" label="Payment date"><input id="payment-date" required type="date" value={paymentDate} disabled={busy} onChange={e=>setPaymentDate(e.target.value)}/></Field></div>{actionError&&<p role="alert" className="form-error">{actionError}</p>}<Button variant="primary" type="submit" loading={busy} disabled={!transactionId.trim()||!paymentDate}>Save payment record</Button></form></AccountsRecordDialog>}
 </section>;
}
