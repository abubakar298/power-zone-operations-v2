import {useCallback,useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {Field} from '../ui/Field.js';
import {FinancialValue} from '../ui/FinancialValue.js';
import {DocumentPreview} from './DocumentPreview.js';

type Footer={label:string;amount:string|null};
export type PendingIpoRevision={id:string;number:string;route:'commercial'|'technical';reason:string;recordId:string;site:string;customer:string;requestedBy:string;createdAt:string;quotationNumber:string;
 before:{id:string;number:string;amount:string|null;footer:Footer[]};after:{amount:string|null;footer:Footer[]}};

/** Management queue: revised IPOs waiting for a decision. Loaded once and after each decision. */
export function useIpoRevisionApprovals(enabled:boolean){
 const [rows,setRows]=useState<PendingIpoRevision[]>(),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{if(!enabled)return;let active=true;void api<{revisions:PendingIpoRevision[]}>('/project-workflow/ipo-revisions/pending').then(v=>{if(active){setRows(v.revisions);setError('');}}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[enabled,revision]);
 return {rows,error,reload:useCallback(()=>setRevision(v=>v+1),[])};
}
export function IpoRevisionBucket({count,selected,onSelect}:{count?:number;selected:boolean;onSelect:()=>void}){
 return <button type="button" className={`stage-card${selected?' selected':''}`} aria-expanded={selected} aria-controls="management-ipo-revisions" onClick={onSelect}><span>IPO revisions</span><strong>{count??'—'}</strong><small>Revised IPOs · reason and old vs new · awaiting your approval</small></button>;
}
export function IpoRevisionQueue({session,rows,error,onDecided}:{session:Session;rows?:PendingIpoRevision[];error:string;onDecided:()=>void}){
 const [open,setOpen]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[notice,setNotice]=useState('');
 async function decide(row:PendingIpoRevision,decision:'Approved'|'Returned'){if(busy)return;setBusy(true);setFailure('');try{await api(`/project-workflow/ipo-revisions/proposals/${row.id}/decision`,{csrf:session.csrfToken,body:{decision,note:note.trim(),requestKey:crypto.randomUUID()}});setNotice(decision==='Approved'?`${row.number} approved: issued and sent to Accounts. ${row.before.number} stays unchanged.`:`${row.number} returned to ${row.requestedBy} with your note.`);setOpen('');setNote('');onDecided();}catch(e){setFailure((e as Error).message);}finally{setBusy(false);}}
 return <section id="management-ipo-revisions" className="pz-panel pz-stack" aria-label="IPO revisions awaiting approval">
  <h2>IPO revisions awaiting approval</h2>
  {notice&&<p role="status" className="ob-success">{notice}</p>}{error&&<p role="alert" className="form-error">{error}</p>}
  {!rows?<p role="status">Loading IPO revisions…</p>:!rows.length?<p>No IPO revisions are waiting for approval.</p>:rows.map(row=><article key={row.id} className="pz-stack">
   <div className="ob-section-title"><div><strong>{row.number}</strong><p>{row.customer} · {row.site} · {row.route==='technical'?'Technical (BOQ and quotation revised)':'Commercial (same BOQ)'} · revised quotation {row.quotationNumber}</p><small>Requested by {row.requestedBy} · revises {row.before.number}</small></div>{open!==row.id&&<Button variant="secondary" onClick={()=>{setOpen(row.id);setNote('');setFailure('');setNotice('');}}>Review</Button>}</div>
   <p><strong>Reason:</strong> {row.reason}</p>
   {open===row.id&&<>
    <div className="pz-table-scroll"><table className="ob-table"><thead><tr><th>Amounts</th><th className="num">Current {row.before.number}</th><th className="num">Proposed {row.number}</th></tr></thead><tbody>
     {[...new Set([...row.before.footer,...row.after.footer].map(f=>f.label))].map(label=><tr key={label}><td>{label}</td><td className="num">{row.before.footer.find(f=>f.label===label)?.amount!=null?<FinancialValue value={row.before.footer.find(f=>f.label===label)!.amount!}/>:'—'}</td><td className="num">{row.after.footer.find(f=>f.label===label)?.amount!=null?<FinancialValue value={row.after.footer.find(f=>f.label===label)!.amount!}/>:'—'}</td></tr>)}
     {!row.before.footer.length&&<tr><td>Total</td><td className="num">{row.before.amount?<FinancialValue value={row.before.amount}/>:'—'}</td><td className="num">{row.after.amount?<FinancialValue value={row.after.amount}/>:'—'}</td></tr>}
    </tbody></table></div>
    <div className="pz-form-grid"><DocumentPreview url={`/api/orders/${row.before.id}/ipo.pdf`} title={`Current ${row.before.number}`}/><DocumentPreview url={`/api/project-workflow/ipo-revisions/proposals/${row.id}/ipo.pdf`} title={`Proposed ${row.number}`}/></div>
    <Field id={'ipo-revision-note-'+row.id} label="Note (required to return)"><textarea id={'ipo-revision-note-'+row.id} maxLength={2000} value={note} disabled={busy} onChange={e=>setNote(e.target.value)}/></Field>
    {failure&&<p role="alert" className="form-error">{failure}</p>}
    <div className="ob-actions"><Button variant="neutral" disabled={busy} onClick={()=>setOpen('')}>Close</Button><Button variant="warning" disabled={busy||note.trim().length<3} onClick={()=>void decide(row,'Returned')}>Return to Coordination</Button><Button variant="success" loading={busy} onClick={()=>void decide(row,'Approved')}>Approve revised IPO</Button></div>
   </>}
  </article>)}
 </section>;
}
