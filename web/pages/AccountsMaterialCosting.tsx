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

const quantity=(v:string)=>decimalDisplay(v).replace(/\.00$/,'').replace(/(\.\d)0$/,'$1');
export function AccountsMaterialCosting({onRecordPt}:{onRecordPt:(record:any)=>void}){
 const [rows,setRows]=useState<any[]>(),[selected,setSelected]=useState<any>(),[detail,setDetail]=useState<any>(),[error,setError]=useState(''),[search,setSearch]=useState(''),[customer,setCustomer]=useState(''),[status,setStatus]=useState('');
 const [page,setPage]=useListPage(JSON.stringify([search,customer,status]));
 useEffect(()=>{let active=true;void api<any>('/accounts-workspace/material-costing').then(v=>{if(active)setRows(v.rows);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 useEffect(()=>{let active=true;setDetail(undefined);if(selected?.report)void api<any>('/inventory-reconciliation/reports/'+selected.report.id).then(v=>{if(active)setDetail(v);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[selected]);
 const filtered=(rows??[]).filter(r=>(!customer||r.customer===customer)&&(!status||r.status===status)&&[r.siteName,r.ipo,r.customer].join(' ').toLowerCase().includes(search.toLowerCase())),p=paginateRows(filtered,page);
 const saved=detail?.versions?.[0],current=!!saved&&saved.version===selected?.report?.version&&saved.stage==='Sent to Accounts';
 const usage=current?saved.snapshot.reconciliation?.sections?.flatMap((s:any)=>s.rows)??[]:[];
 return <section className="accounts-list-panel accounts-material-costing"><header className="accounts-panel-heading"><div><h2>Material Costing &amp; PT Entry</h2><p>Review QC usage and supporting documents, enter material costs in PT, then prepare Job Closure.</p></div></header>
  <div className="accounts-worklist-filters"><Field id="material-costing-search" label="Search site or IPO"><input id="material-costing-search" type="search" value={search} onChange={e=>setSearch(e.target.value)}/></Field><Field id="material-costing-customer" label="Customer"><select id="material-costing-customer" value={customer} onChange={e=>setCustomer(e.target.value)}><option value="">All customers</option>{[...new Set((rows??[]).map(r=>r.customer).filter(Boolean))].sort().map(c=><option key={c}>{c}</option>)}</select></Field><Field id="material-costing-status" label="Status"><select id="material-costing-status" value={status} onChange={e=>setStatus(e.target.value)}><option value="">All pending sites</option><option>Ready for PT entry</option><option>Awaiting QC usage</option></select></Field><Button variant="neutral" onClick={()=>{setSearch('');setCustomer('');setStatus('');}}>Clear filters</Button></div>
  {error&&<p role="alert" className="form-error">{error}</p>}{!rows&&!error?<p role="status">Loading material costing sites…</p>:<><div className="pz-table-scroll"><table className="accounts-entry-table"><thead><tr><th>SR#</th><th>Site / customer</th><th>QC / PT status</th><th>Next action</th></tr></thead><tbody>{p.rows.map((r,i)=><tr key={r.key}><td>{p.start+i+1}</td><td><strong>{r.siteName}</strong><small>{r.customer} · {r.ipo}</small></td><td><strong>{r.status}</strong><small>{r.documents.length} signed documents</small></td><td><Button variant="secondary" onClick={()=>{setError('');setSelected(r);}}>Review material entry</Button></td></tr>)}</tbody></table></div><ListPagination pagination={p} onPageChange={setPage} label="sites"/>{!filtered.length&&<p>No sites awaiting material costing or PT entry.</p>}</>}
  {selected&&<AccountsRecordDialog title="Material Costing & PT Entry" reference={selected.ipo} subtitle={selected.siteName} onClose={()=>{setSelected(undefined);setError('');}}>
   <section className="accounts-record-section"><h3>Material usage</h3>{!selected.report?<p>QC has uploaded documents but has not yet completed the material usage entry. PT completion is unavailable until the quantities are ready.</p>:!detail?<p role="status">Loading saved material quantities…</p>:!current?<p role="alert">This material entry changed. Reopen the queue before recording PT.</p>:<div className="pz-table-scroll"><table className="accounts-signed-document-table"><thead><tr><th>SR#</th><th>Item / description</th><th>UOM</th><th>Approved BOQ</th><th>Actual used</th></tr></thead><tbody>{usage.map((l:any,i:number)=><tr key={l.key}><td>{i+1}</td><td><strong>{l.description}</strong><small>{l.key!==l.description?l.key:''}</small></td><td>{l.unit}</td><td>{quantity(l.approved)}</td><td>{l.installed==null?'Not entered':quantity(l.installed)}</td></tr>)}</tbody></table></div>}<p className="accounts-footnote">Approved BOQ quantities are not warehouse dispatch quantities. Use the signed DO for issued-material evidence.</p></section>
   <section className="accounts-record-section"><h3>Supporting documents</h3><div className="accounts-site-signed-files">{selected.documents.map((d:any)=><div key={d.id}><EvidencePreview url={d.downloadUrl} title={d.kind} filename={d.filename}/><small>{d.filename}</small></div>)}{(detail?.files??[]).map((f:any)=><div key={f.id}><EvidencePreview url={'/api/inventory-reconciliation/files/'+f.id} title={f.filename} filename={f.filename}/></div>)}</div>{!selected.documents.length&&!detail?.files?.length&&<p>No uploaded supporting files are available.</p>}</section>
   {selected.siteId&&<AccountsLocalPurchases siteId={selected.siteId}/>}
   {error&&<p role="alert" className="form-error">{error}</p>}
   <section className="accounts-record-section"><p>Enter the verified material costing in PT first. Record its reference and date to complete this task; remaining expenses belong in Job Closure.</p><Button variant="primary" disabled={!current} onClick={()=>{const r=selected.report;setSelected(undefined);onRecordPt(r);}}>Recorded in PT — Prepare Job Closure</Button></section>
  </AccountsRecordDialog>}
 </section>;
}
