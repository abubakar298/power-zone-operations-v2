import {useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {Field} from '../ui/Field.js';
import {StatusBadge} from '../ui/StatusBadge.js';
import {DocumentPreview} from './DocumentPreview.js';

export type IpoRevisionStatus={original:{id:string;number:string};current:{id:string;number:string;orderNumber?:string|null;amount:string|null};revisedIpos:{id:string;number:string}[];canStart:boolean;quotationSource:boolean;
 blockers:{commercial:string[];technical:string[]};
 revisions:{id:string;sequence:number;route:'commercial'|'technical';reason:string;requestedBy:string;createdAt:string;baseNumber:string;status:string;draftId:string|null;quotationRevisionRequestId:string;sourceBoqRevisionId:string;
  revisedQuotation:{id:string;number:string;status:string|null}|null;proposal:{id:string;version:number;number:string;createdAt:string;amount:string|null}|null;
  decision:{decision:string;note:string;by:string;at:string;revisedIpoId:string|null}|null}[]};
const routes={commercial:'Commercial — prices, GST or terms only (same BOQ)',technical:'Technical — quantities or equipment (revise BOQ and quotation)'};
const tone=(status:string)=>status==='Approved'?'success':status==='Returned'?'danger':'pending';

/** Revise IPO (phase 1): route + reason → revised quotation (and BOQ for technical) through the existing
 * screens → Prepare revised IPO → Management approves with the reason and old vs new in view. */
export function IpoRevisionPanel({session,recordId,status,onChanged,onOpen}:{session:Session;recordId:string;status:IpoRevisionStatus;onChanged:()=>void;onOpen?:(task:any)=>void}){
 const [open,setOpen]=useState(false),[route,setRoute]=useState<''|'commercial'|'technical'>(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[key,setKey]=useState(()=>crypto.randomUUID());
 const blocked=route?status.blockers[route]:[];
 const continueRevision=(r:{id:string;route:string;draftId:string|null},boqRevisionId?:string,quotationRevisionRequestId?:string)=>{
  if(r.route==='technical'&&r.draftId)onOpen?.({target:'boqs',draft_id:r.draftId,kind:'BOQ revision',id:r.draftId});
  else if(boqRevisionId)onOpen?.({target:'pricing',boq_revision_id:boqRevisionId,request_id:quotationRevisionRequestId,kind:'Commercial revision',id:r.id});
 };
 async function start(){if(busy)return;setBusy(true);setError('');try{
  const result=await api<{id:string;route:'commercial'|'technical';draftId:string|null;boqRevisionId:string;quotationRevisionRequestId:string}>(`/project-workflow/${recordId}/ipo-revisions`,{csrf:session.csrfToken,body:{route,reason:reason.trim(),requestKey:key}});
  setOpen(false);setReason('');setRoute('');setKey(crypto.randomUUID());onChanged();
  setNotice(result.route==='technical'?'IPO revision started. Revise the BOQ, then the quotation; after Management approves the quotation, prepare the revised IPO here.':'IPO revision started. Revise the quotation prices or terms; after Management approves the quotation, prepare the revised IPO here.');
  continueRevision(result,result.boqRevisionId,result.quotationRevisionRequestId);
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function prepare(id:string){if(busy)return;setBusy(true);setError('');try{const p=await api<{number:string}>(`/project-workflow/ipo-revisions/${id}/prepare`,{csrf:session.csrfToken,body:{requestKey:crypto.randomUUID()}});setNotice(`Revised IPO ${p.number} sent to Management for approval. Nothing is issued until Management approves.`);onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="pz-panel pz-stack" aria-label="IPO revisions">
  <div className="ob-section-title"><div><h3>IPO revisions</h3><p>{status.revisedIpos.length?`Current IPO: ${status.current.number} · original ${status.original.number}`:'A saved IPO is never changed. A revision makes a new version (for example -R1) after Management approves it.'}</p></div>
   {status.canStart&&!open&&<Button variant="secondary" onClick={()=>{setOpen(true);setNotice('');setError('');}}>Revise IPO</Button>}</div>
  {!status.quotationSource&&<p className="pz-caption">This IPO was not issued from a quotation, so it cannot be revised here.</p>}
  {notice&&<p role="status" className="ob-success">{notice}</p>}
  {open&&<div className="pz-stack" role="group" aria-label="Revise IPO">
   <Field id="ipo-revision-route" label="Revision route (required)"><select id="ipo-revision-route" value={route} disabled={busy} onChange={e=>setRoute(e.target.value as typeof route)}><option value="">Choose route</option>{(Object.keys(routes) as (keyof typeof routes)[]).map(k=><option key={k} value={k}>{routes[k]}</option>)}</select></Field>
   <Field id="ipo-revision-reason" label="Why is this IPO revised? (required — Management will see this)"><textarea id="ipo-revision-reason" maxLength={1900} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></Field>
   {blocked.length>0&&<p role="alert" className="form-error">This route is not available because {blocked.join('; ')}.</p>}
   <div className="ob-actions"><Button variant="neutral" disabled={busy} onClick={()=>{setOpen(false);setError('');}}>Cancel</Button><Button variant="primary" loading={busy} disabled={!route||reason.trim().length<10||blocked.length>0} onClick={()=>void start()}>Start IPO revision</Button></div>
  </div>}
  {error&&<p role="alert" className="form-error">{error}</p>}
  {status.revisions.slice().reverse().map(r=><article key={r.id} className="pz-stack">
   <div className="ob-section-title"><div><strong>Revision {r.sequence} · {r.route==='technical'?'Technical':'Commercial'}</strong><p>{r.reason}</p><small>Requested by {r.requestedBy} · revises {r.baseNumber}</small></div><StatusBadge tone={tone(r.status)}>{r.status}</StatusBadge></div>
   {r.status==='Revising quotation'&&<>
    <p className="pz-caption">{r.revisedQuotation?`Revised quotation ${r.revisedQuotation.number}: ${r.revisedQuotation.status==='Approved'?'approved by Management':r.revisedQuotation.status??'saved'}.`:r.route==='technical'?'Revise the BOQ, then save and submit the revised quotation for Management approval.':'Revise and submit the quotation for Management approval.'}</p>
    <div className="ob-actions">{r.revisedQuotation?.status==='Approved'?<Button variant="primary" loading={busy} onClick={()=>void prepare(r.id)}>Prepare revised IPO</Button>:!r.revisedQuotation&&<Button variant="neutral" onClick={()=>continueRevision(r,r.sourceBoqRevisionId,r.quotationRevisionRequestId)}>{r.route==='technical'?'Continue BOQ revision':'Open the quotation revision'}</Button>}</div>
   </>}
   {r.proposal&&r.status==='Awaiting Management approval'&&<><p>Proposed {r.proposal.number}{r.proposal.amount?` · ${r.proposal.amount}`:''} · waiting for Management. Nothing is issued until it is approved.</p><DocumentPreview url={`/api/project-workflow/ipo-revisions/proposals/${r.proposal.id}/ipo.pdf`} title={`Proposed ${r.proposal.number}`}/></>}
   {r.decision&&<p>{r.decision.decision==='Approved'?`Approved by ${r.decision.by}: ${r.proposal?.number} issued and sent to Accounts.`:`Returned by ${r.decision.by}: ${r.decision.note}`}</p>}
  </article>)}
 </section>;
}

/** Load the record's IPO revision status (current IPO and history). */
export function useIpoRevisionStatus(recordId:string){
 const [status,setStatus]=useState<IpoRevisionStatus>(),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;void api<IpoRevisionStatus>(`/project-workflow/${recordId}/ipo-revisions`).then(v=>{if(active){setStatus(v);setError('');}}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[recordId,revision]);
 return {status,error,reload:()=>setRevision(v=>v+1)};
}
