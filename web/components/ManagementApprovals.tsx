import {lazy,Suspense,useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {DocumentListDetails} from './DocumentListDetails.js';
const QuotationReview=lazy(()=>import('./CoordinatorQuotationReview.js').then(m=>({default:m.CoordinatorQuotationReview}))); 

/** Management home contains approval work only. Existing review/approval routes remain authoritative. */
export function ManagementApprovals({session,onOpen}:{session:Session;onOpen:(task:any)=>void}){
 const [quotes,setQuotes]=useState<any[]>([]),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[expanded,setExpanded]=useState(false),[search,setSearch]=useState(''),[selected,setSelected]=useState<any>();
 useEffect(()=>{
  let active=true;
  const load=async()=>{try{const data=await api<any>('/coordinator?scope=team&includeTraining=false');if(active){setQuotes(data.tasks.filter((t:any)=>t.stage==='Quotation approval'&&t.status==='Awaiting quotation approval'));setLoaded(true);setError('');}}catch(e){if(active)setError((e as Error).message);}};
  const reset=()=>{setSelected(undefined);setExpanded(false);setSearch('');void load();};
  void load();window.addEventListener('focus',load);window.addEventListener('pz:workspace-open',reset);const timer=setInterval(load,30000);
  return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',load);window.removeEventListener('pz:workspace-open',reset);};
 },[session.user.id]);
 async function approved(){setSelected(undefined);try{const data=await api<any>('/coordinator?scope=team&includeTraining=false');setQuotes(data.tasks.filter((t:any)=>t.stage==='Quotation approval'&&t.status==='Awaiting quotation approval'));setError('');}catch(e){setError((e as Error).message);}}
 if(selected)return <Suspense fallback={<p role="status">Opening quotation review…</p>}><QuotationReview key={selected.id} session={session} record={{...selected,sourceQuotationId:selected.id}} onBack={()=>setSelected(undefined)} onApproved={approved} onOpen={onOpen}/></Suspense>;
 const visible=quotes.filter(q=>[q.customer,q.site,q.reference,q.solutionType,q.documentAmount].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
 return <section className="workspace-buckets pz-stack" aria-label="Management approvals">
  <div className="stage-grid"><button type="button" className={`stage-card${expanded?' selected':''}`} aria-expanded={expanded} aria-controls="management-quotation-approvals" onClick={()=>setExpanded(!expanded)}><span>Quotations</span><strong>{loaded?quotes.length:'—'}</strong><small>Awaiting your approval</small></button></div>
  {error&&<p role="alert" className="form-error">{error}</p>}
  {expanded&&<section id="management-quotation-approvals" className="pz-stack" aria-label="Quotations awaiting approval">
   <div className="pz-ups-toolbar"><label className="pz-field">Search quotations<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Customer, site, quotation, amount or solution"/></label><Button variant="neutral" onClick={()=>{setExpanded(false);setSearch('');}}>Back to approvals</Button></div>
   {!loaded&&!error&&<p role="status">Loading quotations awaiting your approval…</p>}
   {loaded&&<><p className="pz-caption" role="status">{visible.length} of {quotes.length} quotations awaiting your approval</p><div className="pz-table-scroll"><table className="master-table"><thead><tr><th>Customer / site</th><th>Quotation / solution / amount</th><th>Submitted</th><th>Next actions</th></tr></thead><tbody>{visible.map(q=><tr key={q.id}><td><strong>{q.customer||'Customer not entered'}</strong><br/>{q.site||'Site not entered'}</td><td>{q.reference}<DocumentListDetails record={q}/></td><td>{Number.isFinite(+new Date(q.started_at))?new Date(q.started_at).toLocaleDateString('en-PK',{timeZone:'Asia/Karachi'}):'Not entered'}</td><td><Button variant="secondary" onClick={()=>q.kind==='C&I proposal'?onOpen(q):setSelected(q)}>Review quotation</Button></td></tr>)}{!visible.length&&<tr><td colSpan={4}>{search?'No quotations match this search.':'No quotations are awaiting your approval.'}</td></tr>}</tbody></table></div></>}
  </section>}
 </section>;
}
