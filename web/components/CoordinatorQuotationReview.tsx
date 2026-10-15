import {QuotationApproval} from "./QuotationApproval.js";
import {useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {QuotationView} from '../pages/Commercial.js';
import {RevisionEntry} from './RevisionEntry.js';

export function CoordinatorQuotationReview({session,record,onBack,onOpen,onApproved}:{session:Session;record:any;onBack:()=>void;onApproved?:()=>Promise<void>;onOpen?:(task:any)=>void}){
 const [quote,setQuote]=useState<any>(),[error,setError]=useState(''),[revising,setRevising]=useState<false|"edit"|"return">(false),[approving,setApproving]=useState(Boolean(record.recordApproval));
 const followup=Boolean(record.followupPreview);
 const id=record.sourceQuotationId??record.quotation?.id;
 useEffect(()=>{let active=true;setQuote(undefined);setError('');setRevising(false);void api<any>(`/commercial/quotations/${id}`).then(q=>{if(active)setQuote(q);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[id]);
 return <div className="pz-stack">
  <Button variant="neutral" onClick={onBack}>{followup?"Back to Customer Follow-up":"Back to Management Review"}</Button>
  {error&&<p className="form-error" role="alert">{error}</p>}
  {!quote&&!error&&<p role="status">Loading quotation…</p>}
  {quote&&<>
   <section className="pz-panel"><h2>Quotation Summary</h2>
    <div className="pz-form-grid"><div><strong>{quote.number}</strong><p>{quote.snapshot.customer?.name} · {quote.snapshot.siteName}</p></div><div><p>Version {quote.version} · {quote.workflow_status??'Draft'}</p><p>{new Date(quote.created_at).toLocaleString('en-PK')}</p></div></div>
    {quote.workflow_notes&&<p>{quote.workflow_notes}</p>}
    <details><summary>Quotation History</summary><div className="pz-table-scroll"><table><thead><tr><th>Quotation</th><th>Date</th><th>Revision details</th></tr></thead><tbody>{(quote.workflow_history??[]).flatMap((b:any)=>b.quotations??[]).map((q:any)=><tr key={q.id}><td>{q.number}</td><td>{q.quoted_at?new Date(q.quoted_at).toLocaleString('en-PK'):'Not recorded'}</td><td>{q.revision?.reason??'Original quotation'}</td></tr>)}</tbody></table></div></details>
   </section>
   <section className="pz-panel"><h2>{quote.workflow_status==='Approved'?'Approved Quotation Preview':'Submitted Quotation Preview'}</h2><QuotationView showActions={false} snapshot={quote.snapshot} number={quote.number} pdfUrl={`/api/commercial/quotations/${quote.id}/quotation.pdf`}/>
   <div className="pz-action-row">{!followup&&quote.workflow_status==='Submitted'&&<Button variant="success" onClick={()=>setApproving(v=>!v)} aria-expanded={approving}>Record Approval</Button>}<a className="button" href={`/api/commercial/quotations/${quote.id}/quotation.pdf`} download>Download PDF for Sharing</a>{!followup&&["Admin","Management"].includes(session.user.role)&&quote.workflow_status==='Submitted'&&<Button variant="warning" onClick={()=>setRevising(v=>v==="return"?false:"return")} aria-expanded={revising==="return"}>Return to Atif for Revision</Button>}{!followup&&<Button variant="secondary" onClick={()=>setRevising(v=>v==="edit"?false:"edit")} aria-expanded={revising==="edit"}>Revise Quotation</Button>}</div></section>
   {!followup&&approving&&quote.workflow_status==='Submitted'&&<QuotationApproval session={session} quotationId={quote.id} onApproved={async()=>{if(onApproved)await onApproved();else onBack();}}/>}
   {!followup&&revising&&<RevisionEntry key={revising} intent={revising} embedded session={session} record={{...record,sourceQuotationId:quote.id}} onBack={()=>revising==='return'?onBack():setRevising(false)} onOpen={onOpen}/>}
  </>}
 </div>;
}
