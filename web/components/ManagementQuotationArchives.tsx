import {useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {PagedTableBody} from '../ui/PagedTableBody.js';
import {confirmRevision} from '../confirm.js';

export function QuotationArchiveButton({session,id,kind='quotation',number,archived=false,onChanged}:{session:Session;id:string;kind?:'quotation'|'cni';number:string;archived?:boolean;onChanged:()=>void|Promise<void>}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 if(!['Admin','Management'].includes(session.user.role))return null;
 async function change(){
  if(!await confirmRevision(archived?'Restore quotation':'Archive quotation',`${number}\n\n${archived?'Return this quotation to its previous workflow stage?':'Remove this quotation from active work lists? Its saved quotation, BOQ and revision history remain available, and Management can restore it.'}`,archived?'Restore':'Archive'))return;
  setBusy(true);setError('');try{await api(`/commercial/quotation-archive/${id}`,{csrf:session.csrfToken,body:{kind,archived:!archived}});await onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <div className="pz-stack"><Button variant="neutral" loading={busy} loadingLabel={archived?'Restoring…':'Archiving…'} onClick={()=>void change()}>{archived?'Restore quotation':'Archive quotation'}</Button>{error&&<p role="alert" className="form-error">{error}</p>}</div>;
}
export function ManagementQuotationArchives({session,onChanged}:{session:Session;onChanged:()=>void|Promise<void>}){
 const [open,setOpen]=useState(false),[rows,setRows]=useState<any[]>([]),[error,setError]=useState(''),[loaded,setLoaded]=useState(false),[search,setSearch]=useState(''),[archived,setArchived]=useState(false);
 async function load(){try{const data=await api<any>('/commercial/quotation-archive-register');setRows(data.quotations);setLoaded(true);setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{if(open)void load();},[open]);
 const filtered=rows.filter(r=>r.archived===archived&&[r.number,r.customer,r.site].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
 return <section className="pz-stack" aria-label="Manage quotation archives"><Button variant="neutral" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>Manage quotation archives</Button>{open&&<>
  <div className="pz-action-row"><Button variant={archived?'neutral':'secondary'} onClick={()=>setArchived(false)}>Active quotations</Button><Button variant={archived?'secondary':'neutral'} onClick={()=>setArchived(true)}>Archived quotations</Button></div>
  <label className="pz-field">Search quotations to archive or restore<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Quotation number, customer or site"/></label>
  {error&&<p role="alert" className="form-error">{error}</p>}{!loaded&&!error&&<p role="status">Loading quotation register…</p>}
  {loaded&&<><p role="status" className="pz-caption">{filtered.length} {archived?'archived':'active'} quotations · most recent first</p><div className="pz-table-scroll"><table className="master-table pz-table"><thead><tr><th>SR#</th><th>Quotation</th><th>Customer / site</th><th>Created</th><th>Action</th></tr></thead><PagedTableBody label="quotations">{filtered.map((r,index)=><tr key={r.id}><td>{index+1}</td><td><strong>{r.number}</strong><p className="pz-caption">Version {r.version}</p></td><td><strong>{r.customer}</strong><p className="pz-caption">{r.site}</p></td><td>{new Date(r.created_at).toLocaleDateString('en-PK')}</td><td><QuotationArchiveButton session={session} {...r} onChanged={async()=>{await load();await onChanged();}}/></td></tr>)}{!filtered.length&&<tr><td colSpan={5}>No quotations match this selection.</td></tr>}</PagedTableBody></table></div></>}
 </>}</section>;
}
