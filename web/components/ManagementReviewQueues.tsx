import {useCallback,useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {money} from '../numbers.js';
import {Button} from '../ui/Button.js';
import {Field} from '../ui/Field.js';
import {jobLabel} from './job-label.js';
import {DocumentPreview} from './DocumentPreview.js';
import {confirmRevision} from '../confirm.js';
import {awaitingClosures,pendingTechnicalPackages,pendingBoqReviews} from '../workspaces/management-reviews.js';

export function useManagementReviews(userId:string){
 const [closures,setClosures]=useState<any[]>(),[technical,setTechnical]=useState<{packages:any[];boqs:any[]}>(),[closureError,setClosureError]=useState(''),[technicalError,setTechnicalError]=useState(''),[refresh,setRefresh]=useState(0);
 const reload=useCallback(()=>setRefresh(n=>n+1),[]);
 useEffect(()=>{
  let active=true,generation=0;
  async function load(){const n=++generation;
   await Promise.allSettled([
    api<any>('/accounts-workspace').then(d=>{if(active&&n===generation){setClosures(awaitingClosures(d.closures));setClosureError('');}}).catch(e=>{if(active&&n===generation)setClosureError(e.message);}),
    Promise.all([api<any>('/project-workflow/ubl-survey-packages'),api<any>('/project-workflow?department=coordination&scope=team'),api<any>('/boqs/reviews')]).then(([p,r,b])=>{if(active&&n===generation){setTechnical({packages:pendingTechnicalPackages(p.packages,r.records),boqs:pendingBoqReviews(b.reviews)});setTechnicalError('');}}).catch(e=>{if(active&&n===generation)setTechnicalError(e.message);})
   ]);
  }
  void load();const timer=setInterval(load,30000);window.addEventListener('focus',load);window.addEventListener('pz:workspace-open',load);
  return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',load);window.removeEventListener('pz:workspace-open',load);};
 },[userId,refresh]);
 return {closures,technical,closureError,technicalError,reload};
}
export function ManagementReviewBuckets({data,selected,onSelect}:{data:ReturnType<typeof useManagementReviews>;selected:string;onSelect:(key:string)=>void}){
 return <>{[['CLOSURES','Jobs awaiting closure',data.closures?.length,'Accounts costing submitted · awaiting your approval'],['TECHNICAL','Technical reviews',data.technical?data.technical.packages.length+data.technical.boqs.length:undefined,'Submitted reports · awaiting your approval']].map(([key,label,count,caption])=><button type="button" className={`stage-card${selected===key?' selected':''}`} key={key} aria-expanded={selected===key} onClick={()=>onSelect(String(key))}><span>{label}</span><strong>{count??'—'}</strong><small>{caption}</small></button>)}</>;
}
export function ManagementClosureQueue({rows,error,onOpen}:{rows:any[]|undefined;error:string;onOpen:(key:string)=>void}){
 const [search,setSearch]=useState('');const visible=(rows??[]).filter(c=>jobLabel(c.snapshot).toLowerCase().includes(search.trim().toLowerCase()));
 return <section className="pz-stack" aria-label="Jobs awaiting closure"><h2>Jobs awaiting closure</h2><p>Accounts has submitted these saved costs for your approval. Drafts and already closed jobs are excluded.</p>{error&&<p role="alert" className="form-error">{error}</p>}{!rows&&!error&&<p role="status">Loading submitted job closures…</p>}{rows&&<><label className="pz-field">Search jobs awaiting closure<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Job, site, branch or configuration"/></label><p role="status">{visible.length} of {rows.length} jobs</p><div className="pz-table-scroll"><table className="master-table"><thead><tr><th>Job / site / configuration</th><th>Accounts submission</th><th>Selling price · excl. GST</th><th>Actual cost · excl. GST</th><th>Action</th></tr></thead><tbody>{visible.map(c=><tr key={c.id}><td>{jobLabel(c.snapshot)}</td><td>Version {c.version}<br/>{new Date(c.created_at).toLocaleDateString('en-PK',{timeZone:'Asia/Karachi'})}</td><td className="pz-number">{money(c.snapshot.summary?.selling)}</td><td className="pz-number">{money(c.snapshot.summary?.actual)}</td><td><Button variant="secondary" onClick={()=>onOpen(c.job_key)}>Review job closure</Button></td></tr>)}{!visible.length&&<tr><td colSpan={5}>{search?'No submitted closures match this search.':'No job closures are awaiting your approval.'}</td></tr>}</tbody></table></div></>}</section>;
}
function TechnicalPackageReview({pkg,session,onDecided}:{pkg:any;session:Session;onDecided:()=>void}){
 const [preview,setPreview]=useState(false),[reviewed,setReviewed]=useState(false),[notes,setNotes]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
 async function decide(decision:string){if(busy)return;setError('');if(!reviewed||!notes.trim()){setError('Review the saved report and enter your decision note first.');return;}
  if(!await confirmRevision(decision==='Approved'?'Approve technical review':'Return technical review',`${pkg.pendingSites.map((s:any)=>s.siteName).join(', ')}\nDecide the displayed saved versions for ${pkg.pendingSites.length} sites?`,decision==='Approved'?'Approve':'Return for revision'))return;
  setBusy(true);try{await api(`/project-workflow/ubl-survey-packages/${pkg.id}/decision`,{csrf:session.csrfToken,body:{requestKey:crypto.randomUUID(),decision,notes,versions:pkg.pendingSites.map((s:any)=>({id:s.recordId,version:s.version}))}});setDone(true);onDecided();}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 if(done)return <p role="status">Technical review decision saved.</p>;
 return <article className="pz-panel pz-stack"><h3>{pkg.pendingSites.length>1?`Combined technical review · ${pkg.pendingSites.length} sites`:`${pkg.pendingSites[0].siteName} · ${pkg.pendingSites[0].siteCode}`}</h3><p>{pkg.pendingSites.map((s:any)=>`${s.siteCode} · ${s.siteName} · v${s.version}`).join('; ')}</p><div className="pz-action-row"><Button variant="secondary" onClick={()=>setPreview(v=>!v)} aria-expanded={preview}>{preview?'Hide saved report':'Review saved report'}</Button><a className="button" href={`/api/project-workflow/ubl-survey-packages/${pkg.id}/xlsx`}>Download UBL Excel</a></div>{preview&&<DocumentPreview url={`/api/project-workflow/ubl-survey-packages/${pkg.id}/pdf`} title="Submitted technical review report"/>}<label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/> I reviewed the saved report and Excel for these sites</label><Field id={`technical-note-${pkg.id}`} label="Management decision note"><textarea id={`technical-note-${pkg.id}`} value={notes} disabled={busy} onChange={e=>setNotes(e.target.value)}/></Field><div className="pz-action-row"><Button variant="success" disabled={!reviewed||!notes.trim()} loading={busy} onClick={()=>void decide('Approved')}>Approve technical review</Button><Button variant="warning" disabled={busy||!reviewed||!notes.trim()} onClick={()=>void decide('Changes requested')}>Return for revision</Button></div>{error&&<p role="alert" className="form-error">{error}</p>}</article>;
}
export function ManagementTechnicalQueue({data,error,session,onOpen,onDecided}:{data:{packages:any[];boqs:any[]}|undefined;error:string;session:Session;onOpen:(task:any)=>void;onDecided:()=>void}){
 const [search,setSearch]=useState('');const matches=(s:string)=>s.toLowerCase().includes(search.trim().toLowerCase());
 const packages=(data?.packages??[]).filter(p=>matches(p.pendingSites.map((s:any)=>s.siteName+' '+s.siteCode).join(' '))),boqs=(data?.boqs??[]).filter(r=>matches([r.customer,r.site,r.submitted_by_name].join(' ')));
 return <section className="pz-stack" aria-label="Technical reviews awaiting approval"><h2>Technical reviews awaiting your approval</h2><p>Saved survey report packages and BOQ reviews requiring your decision. Reports sent for information only are excluded.</p>{error&&<p role="alert" className="form-error">{error}</p>}{!data&&!error&&<p role="status">Loading submitted technical reviews…</p>}{data&&<><label className="pz-field">Search technical reviews<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Site, branch, customer or submitted by"/></label><p role="status">{packages.length+boqs.length} reviews shown</p>{packages.map(p=><TechnicalPackageReview key={p.id+JSON.stringify(p.pendingSites.map((s:any)=>s.version))} pkg={p} session={session} onDecided={onDecided}/>)}{boqs.map(r=><article className="pz-panel pz-stack" key={r.id}><h3>{r.customer} · {r.site}</h3><p>BOQ technical review · submitted by {r.submitted_by_name} · v{r.draft_version}</p><Button variant="secondary" onClick={()=>onOpen({id:r.id,kind:'Survey / BOQ',draft_id:r.draft_id,target:'boqs'})}>Review submitted BOQ</Button></article>)}{!packages.length&&!boqs.length&&<p>No technical reviews match this selection.</p>}</>}</section>;
}
