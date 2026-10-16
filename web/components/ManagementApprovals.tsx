import {lazy,Suspense,useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {confirmRevision} from '../confirm.js';
import {money} from '../numbers.js';
import {Decimal} from 'decimal.js';
import {snapshotListMetadata} from '../../server/documents/list-metadata.js';
import {Button} from '../ui/Button.js';
import {DocumentListDetails} from './DocumentListDetails.js';
const QuotationReview=lazy(()=>import('./CoordinatorQuotationReview.js').then(m=>({default:m.CoordinatorQuotationReview}))); 

/** Management home contains approval work only. Existing review/approval routes remain authoritative. */
export function ManagementApprovals({session,onOpen}:{session:Session;onOpen:(task:any)=>void}){
 const [quotes,setQuotes]=useState<any[]>([]),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[expanded,setExpanded]=useState(false),[search,setSearch]=useState(''),[selected,setSelected]=useState<any>(),[approving,setApproving]=useState<string>(),[failure,setFailure]=useState<{id:string;message:string}>(),[notice,setNotice]=useState('');
 useEffect(()=>{
  let active=true;
  const load=async()=>{try{const data=await api<any>('/coordinator?scope=team&includeTraining=false');if(active){setQuotes(data.tasks.filter((t:any)=>t.stage==='Quotation approval'&&t.status==='Awaiting quotation approval'));setLoaded(true);setError('');}}catch(e){if(active)setError((e as Error).message);}};
  const reset=()=>{setSelected(undefined);setExpanded(false);setSearch('');void load();};
  void load();window.addEventListener('focus',load);window.addEventListener('pz:workspace-open',reset);const timer=setInterval(load,30000);
  return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',load);window.removeEventListener('pz:workspace-open',reset);};
 },[session.user.id]);
 async function approved(){setSelected(undefined);try{const data=await api<any>('/coordinator?scope=team&includeTraining=false');setQuotes(data.tasks.filter((t:any)=>t.stage==='Quotation approval'&&t.status==='Awaiting quotation approval'));setError('');}catch(e){setError((e as Error).message);}}
 async function approve(task:any){
  if(approving)return;
  setApproving(task.id);setFailure(undefined);setNotice('');
  try{
   const cni=task.kind==='C&I proposal';
   const detail=await api<any>(cni?`/cni/${task.id}`:`/commercial/quotations/${task.id}`);
   const document=cni?detail.versions?.[0]:detail;
   const pending=cni?detail.actions.filter((a:any)=>a.version_id===document?.id).at(-1)?.action==='Approval requested':detail.workflow_status==='Submitted';
   const amount=snapshotListMetadata(document?.snapshot).documentAmount;
   if(!document||!cni&&detail.workflow_latest===false||document.number!==task.reference||!pending||amount===null||task.documentAmount==null||!new Decimal(amount).eq(task.documentAmount))throw Error('This quotation changed or is no longer awaiting approval. Refresh the list and review its saved version.');
   const comparison=document.snapshot?.revision?.comparison;
   const changed=Boolean(comparison?.previousPayable&&comparison?.proposedPayable&&!new Decimal(comparison.previousPayable).eq(comparison.proposedPayable));
   const message=`${task.customer} · ${task.site}\n${document.number}\nFinal payable: PKR ${money(amount)}${changed?`\nRevision payable changed from PKR ${money(comparison.previousPayable)} to PKR ${money(comparison.proposedPayable)}. Approving acknowledges this change.`:''}\n\nApprove this saved quotation and move it to Ready to Send?`;
   if(!await confirmRevision('Approve quotation',message,'Approve'))return;
   if(cni)await api(`/cni/${task.id}/review`,{csrf:session.csrfToken,body:{versionId:document.id,action:'Approved',remarks:'Approved by Management from the quotation approval list.'}});
   else await api('/coordinator/events',{csrf:session.csrfToken,body:{quotationId:task.id,kind:'Approved',notes:'Approved by Management from the quotation approval list.',acknowledgePriceChange:changed}});
   setQuotes(old=>old.filter(q=>q.id!==task.id));setNotice(`${document.number} approved — Ready to Send.`);await approved();
  }catch(e){setFailure({id:task.id,message:(e as Error).message});}finally{setApproving(undefined);}
 }
 if(selected)return <Suspense fallback={<p role="status">Opening quotation review…</p>}><QuotationReview key={selected.id} session={session} record={{...selected,sourceQuotationId:selected.id}} onBack={()=>setSelected(undefined)} onApproved={approved} onOpen={onOpen}/></Suspense>;
 const visible=quotes.filter(q=>[q.customer,q.site,q.reference,q.solutionType,q.documentAmount].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
 return <section className="workspace-buckets pz-stack" aria-label="Management approvals">
  <div className="stage-grid"><button type="button" className={`stage-card${expanded?' selected':''}`} aria-expanded={expanded} aria-controls="management-quotation-approvals" onClick={()=>setExpanded(!expanded)}><span>Quotations</span><strong>{loaded?quotes.length:'—'}</strong><small>Awaiting your approval</small></button></div>
  {error&&<p role="alert" className="form-error">{error}</p>}
  {notice&&<p role="status" className="pz-feedback pz-feedback--success">{notice}</p>}
  {expanded&&<section id="management-quotation-approvals" className="pz-stack" aria-label="Quotations awaiting approval">
   <div className="pz-ups-toolbar"><label className="pz-field">Search quotations<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Customer, site, quotation, amount or solution"/></label><Button variant="neutral" onClick={()=>{setExpanded(false);setSearch('');}}>Back to approvals</Button></div>
   {!loaded&&!error&&<p role="status">Loading quotations awaiting your approval…</p>}
   {loaded&&<><p className="pz-caption" role="status">{visible.length} of {quotes.length} quotations awaiting your approval</p><div className="pz-table-scroll"><table className="master-table"><thead><tr><th>Customer / site</th><th>Quotation / solution / amount</th><th>Submitted</th><th>Next actions</th></tr></thead><tbody>{visible.map(q=><tr key={q.id}><td><strong>{q.customer||'Customer not entered'}</strong><br/>{q.site||'Site not entered'}</td><td>{q.reference}<DocumentListDetails record={q}/></td><td>{Number.isFinite(+new Date(q.started_at))?new Date(q.started_at).toLocaleDateString('en-PK',{timeZone:'Asia/Karachi'}):'Not entered'}</td><td><div className="pz-action-row"><Button variant="secondary" disabled={Boolean(approving)} onClick={()=>q.kind==='C&I proposal'?onOpen(q):setSelected(q)}>Review quotation</Button><Button variant="success" loading={approving===q.id} loadingLabel="Approving…" disabled={Boolean(approving)} onClick={()=>void approve(q)}>Approve</Button></div>{failure?.id===q.id&&<p role="alert" className="form-error">{failure?.message}</p>}</td></tr>)}{!visible.length&&<tr><td colSpan={4}>{search?'No quotations match this search.':'No quotations are awaiting your approval.'}</td></tr>}</tbody></table></div></>}
  </section>}
 </section>;
}
