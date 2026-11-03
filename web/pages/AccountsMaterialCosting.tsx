import {recentFirst} from '../../shared/recent-records.js';
import './accounts-material-costing.css';
import {useEffect,useState} from 'react';
import {api} from '../api.js';
import {Button} from '../ui/Button.js';
import {Field} from '../ui/Field.js';
import {ListPagination,paginateRows,useListPage} from '../ui/ListPagination.js';
import {AccountsRecordDialog} from '../components/AccountsRecordDialog.js';
import {EvidencePreview} from '../components/EvidencePreview.js';
import {AccountsLocalPurchases} from '../components/AccountsLocalPurchases.js';
import {decimalDisplay} from '../numbers.js';
import {SiteDocumentsDialog} from '../components/SiteDocumentsDialog.js';
import '../components/site-documents.css';

const quantity=(v:string)=>decimalDisplay(v).replace(/\.00$/,'').replace(/(\.\d)0$/,'$1');
export function AccountsMaterialCosting({onRecorded}:{onRecorded:(row:any)=>void|Promise<void>}){
 const [ptFor,setPtFor]=useState<any>(),[documentsFor,setDocumentsFor]=useState<any>(),[message,setMessage]=useState('');
 const [rows,setRows]=useState<any[]>(),[selected,setSelected]=useState<any>(),[detail,setDetail]=useState<any>(),[error,setError]=useState(''),[search,setSearch]=useState(''),[customer,setCustomer]=useState(''),[status,setStatus]=useState('');
 const [page,setPage]=useListPage(JSON.stringify([search,customer,status]));
 async function reload(){setRows((await api<any>('/accounts-workspace/material-costing')).rows);}
 useEffect(()=>{let active=true;void api<any>('/accounts-workspace/material-costing').then(v=>{if(active)setRows(v.rows);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 useEffect(()=>{let active=true;setDetail(undefined);if(selected?.report)void api<any>('/inventory-reconciliation/reports/'+selected.report.id).then(v=>{if(active)setDetail(v);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[selected]);
 const filtered=(rows??[]).filter(r=>(!customer||r.customer===customer)&&(!status||r.status===status)&&[r.siteName,r.ipo,r.customer].join(' ').toLowerCase().includes(search.toLowerCase())),p=paginateRows(recentFirst(filtered),page);
 const saved=detail?.versions?.[0],current=!!saved&&saved.version===selected?.report?.version&&saved.stage==='Sent to Accounts';
 const usage=current?[...(saved.snapshot.reconciliation?.sections?.flatMap((s:any)=>s.rows)??[]),...(saved.snapshot.entry?.extra??[]).map((c:any)=>({key:c.description,description:c.description,unit:c.unit,approved:null,installed:c.used}))]:[];
 return <section className="accounts-list-panel accounts-material-costing"><header className="accounts-panel-heading"><div><h2>Material Costing &amp; PT Entry</h2><p>Review QC usage and supporting documents, enter material costs in Peachtree, then mark the job as recorded in PT. It then moves to Job Closure Preparation.</p></div></header>{message&&<p role="status">{message}</p>}
  <div className="accounts-worklist-filters"><Field id="material-costing-search" label="Search site or IPO"><input id="material-costing-search" type="search" value={search} onChange={e=>setSearch(e.target.value)}/></Field><Field id="material-costing-customer" label="Customer"><select id="material-costing-customer" value={customer} onChange={e=>setCustomer(e.target.value)}><option value="">All customers</option>{[...new Set((rows??[]).map(r=>r.customer).filter(Boolean))].sort().map(c=><option key={c}>{c}</option>)}</select></Field><Field id="material-costing-status" label="Status"><select id="material-costing-status" value={status} onChange={e=>setStatus(e.target.value)}><option value="">All pending sites</option><option>Ready for PT entry</option><option>Awaiting QC usage</option></select></Field><Button variant="neutral" onClick={()=>{setSearch('');setCustomer('');setStatus('');}}>Clear filters</Button></div>
  {error&&<p role="alert" className="form-error">{error}</p>}{!rows&&!error?<p role="status">Loading material costing sites…</p>:<><div className="pz-table-scroll"><table className="accounts-entry-table"><thead><tr><th>SR#</th><th>Site / customer</th><th>QC / PT status</th><th>Next action</th></tr></thead><tbody>{p.rows.map((r,i)=><tr key={r.key}><td>{p.start+i+1}</td><td><strong>{r.siteName}</strong><small>{r.customer} · {r.ipo}</small></td><td><strong>{r.status}</strong><small>{r.documents.length} signed documents</small></td><td><div className="site-documents-actions"><Button variant="neutral" onClick={()=>{setError('');setSelected(r);}}>View Material Usage &amp; Documents</Button><Button variant="primary" onClick={()=>{setError('');setMessage('');setPtFor(r);}}>Mark as Recorded in PT</Button></div></td></tr>)}</tbody></table></div><ListPagination pagination={p} onPageChange={setPage} label="sites"/>{!filtered.length&&<p>No sites awaiting material costing or PT entry.</p>}</>}
  {selected&&<AccountsRecordDialog title="Material Costing & PT Entry" reference={selected.ipo} subtitle={selected.siteName} onClose={()=>{setSelected(undefined);setError('');}}>
   <section className="accounts-record-section"><h3>Material usage</h3>{!selected.report?<p>QC has uploaded documents but has not yet completed the material usage entry. You can still mark the job as recorded in PT once you have entered its costs in Peachtree.</p>:!detail?<p role="status">Loading saved material quantities…</p>:!current?<p role="alert">This material entry changed. Reopen the queue before recording PT.</p>:<div className="pz-table-scroll"><table className="accounts-signed-document-table"><thead><tr><th>SR#</th><th>Item / description</th><th>UOM</th><th>Approved BOQ</th><th>Actual used</th></tr></thead><tbody>{usage.map((l:any,i:number)=><tr key={l.key}><td>{i+1}</td><td><strong>{l.description}</strong><small>{l.key!==l.description?l.key:''}</small></td><td>{l.unit}</td><td>{l.approved===null?'Not in BOQ':quantity(l.approved)}</td><td>{l.installed==null?'Not entered':quantity(l.installed)}</td></tr>)}</tbody></table></div>}<p className="accounts-footnote">Approved BOQ quantities are not warehouse dispatch quantities. Use the signed DO for issued-material evidence.</p></section>
   <section className="accounts-record-section"><h3>Supporting documents</h3><div className="accounts-site-signed-files">{selected.documents.map((d:any)=><div key={d.id}><EvidencePreview url={d.downloadUrl} title={d.kind} filename={d.filename}/><small>{d.filename}</small></div>)}{(detail?.files??[]).map((f:any)=><div key={f.id}><EvidencePreview url={'/api/inventory-reconciliation/files/'+f.id} title={f.filename} filename={f.filename}/></div>)}</div>{!selected.documents.length&&!detail?.files?.length&&<p>No uploaded supporting files are available.</p>}{selected.siteId&&<Button variant="neutral" onClick={()=>setDocumentsFor(selected)}>View all QC documents &amp; pictures</Button>}</section>
   {selected.siteId&&<AccountsLocalPurchases siteId={selected.siteId}/>}
   {error&&<p role="alert" className="form-error">{error}</p>}
   <section className="accounts-record-section"><p>QC evidence does not mark PT entry or job closure complete. After entering these costs in Peachtree, mark the job as recorded in PT.</p><Button variant="primary" onClick={()=>{const r=selected;setSelected(undefined);setPtFor(r);}}>Mark as Recorded in PT</Button></section>
  </AccountsRecordDialog>}
  {ptFor&&<MarkRecordedInPt row={ptFor} onClose={()=>setPtFor(undefined)} onSaved={async(saved:any)=>{const row=ptFor;setPtFor(undefined);setMessage(`${row.siteName} marked as recorded in PT (${saved.pt_reference}). It is now in Job Closure Preparation, where you can add other PT expenses before submitting to Management.`);try{await reload();}catch{}await onRecorded(row);}}/>}
  {documentsFor&&<SiteDocumentsDialog siteId={documentsFor.siteId} title={documentsFor.siteName} reference={documentsFor.ipo} onClose={()=>setDocumentsFor(undefined)}/>}
 </section>;
}

/** Saves the PT reference and entry date. Invoicing and Inventory returns stay separate. */
function MarkRecordedInPt({row,onClose,onSaved}:{row:any;onClose:()=>void;onSaved:(saved:any)=>void|Promise<void>}){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const [reference,setReference]=useState(''),[date,setDate]=useState(today),[notes,setNotes]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState(''),[requestKey]=useState(()=>crypto.randomUUID());
 async function save(){if(saving)return;setSaving(true);setError('');try{const session=await api<any>('/auth/session');const saved=await api<any>('/accounts-workspace/material-costing/pt-entry',{csrf:session.csrfToken,body:{jobKey:row.key,ptReference:reference,entryDate:date,notes,requestKey}});await onSaved(saved);}catch(e){setError((e as Error).message);}finally{setSaving(false);}}
 return <AccountsRecordDialog title="Mark as Recorded in PT" reference={row.ipo} subtitle={row.siteName} onClose={()=>{if(!saving)onClose();}}>
  <form className="accounts-record-section" onSubmit={e=>{e.preventDefault();void save();}}>
   <p>Confirm you have entered this job's material costs in Peachtree, then save the PT reference and entry date.</p>
   <div className="pz-form-grid" style={{alignItems:'start'}}>
    <Field id="job-pt-reference" label="PT reference (required)"><input id="job-pt-reference" required maxLength={200} value={reference} onChange={e=>setReference(e.target.value)} disabled={saving}/></Field>
    <Field id="job-pt-date" label="PT entry date"><input id="job-pt-date" type="date" required max={today} value={date} onChange={e=>setDate(e.target.value)} disabled={saving}/></Field>
    <Field id="job-pt-notes" label="Notes"><textarea id="job-pt-notes" maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)} disabled={saving}/></Field>
   </div>
   {!row.report&&<p className="pz-caption">Inventory has not sent its reconciliation yet. The job still moves to Job Closure Preparation; its closure costing opens once Inventory sends the reconciliation.</p>}
   {error&&<p role="alert" className="form-error">{error}</p>}
   <div className="site-documents-actions"><Button variant="primary" type="submit" disabled={saving||!reference.trim()||!date}>{saving?'Saving…':'Mark as Recorded in PT'}</Button><Button variant="neutral" type="button" disabled={saving} onClick={onClose}>Cancel</Button></div>
  </form>
 </AccountsRecordDialog>;
}
