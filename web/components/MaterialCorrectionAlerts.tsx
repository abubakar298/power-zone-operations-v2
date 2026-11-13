import {useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {Field} from '../ui/Field.js';
import {AccountsRecordDialog} from './AccountsRecordDialog.js';
/** Reconciliation corrections live on the Alerts pages (Accounts and Inventory), never on dashboards.
 * Once the work is done, a resolution note closes the alert; the alert record itself is kept. */
export function MaterialCorrectionAlerts({session,inventory=false}:{session:Session;inventory?:boolean}){
 const [alerts,setAlerts]=useState<any[]>(),[error,setError]=useState(''),[open,setOpen]=useState(false),[ipo,setIpo]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [resolving,setResolving]=useState(''),[note,setNote]=useState(''),[notice,setNotice]=useState('');
 const owner=['Admin','Management'].includes(session.user.role),path=inventory?'/material-dispatches/material-corrections':'/accounts-workspace/material-corrections';
 async function load(){try{setAlerts((await api<any>(path)).alerts);setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[path]);
 async function save(){if(busy)return;setBusy(true);setError('');try{await api('/accounts-workspace/material-corrections',{csrf:session.csrfToken,body:{ipoNumber:ipo,message,requestKey:crypto.randomUUID()}});setOpen(false);setIpo('');setMessage('');await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function resolve(alert:{id:string;site_name:string}){if(busy)return;setBusy(true);setError('');try{await api('/accounts-workspace/material-corrections/'+encodeURIComponent(alert.id)+'/resolve',{csrf:session.csrfToken,body:{note:note.trim(),requestKey:crypto.randomUUID()}});setResolving('');setNote('');setNotice(alert.site_name+' marked resolved. It is removed from this list; its record is kept.');await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="pz-panel pz-stack" aria-label="Reconciliation corrections"><div className="ob-section-title"><div><h2>Reconciliation corrections{alerts?.length?' · '+alerts.length:''}</h2><p>Accounts and Inventory review these quantity discrepancies. When the work is done, click Mark resolved and say what was done. Closed jobs and posted stock remain unchanged.</p></div>{owner&&!inventory&&<Button variant="secondary" onClick={()=>setOpen(true)}>Flag reconciliation correction</Button>}</div>
  {notice&&<p role="status" className="ob-success">{notice}</p>}{error&&!open&&<p role="alert" className="form-error">{error}</p>}
  {alerts&&!alerts.length&&<p>No open reconciliation corrections.</p>}
  {alerts?.map(a=><article key={a.id} className="pz-stack"><div className="ob-section-title"><div><strong>{a.site_name} · CHP-{a.legacy_ipo_number}</strong><p>{a.message}</p></div>{resolving!==a.id&&<Button variant="neutral" disabled={busy} onClick={()=>{setResolving(a.id);setNote('');setNotice('');}}>Mark resolved</Button>}</div>
   {resolving===a.id&&<div className="pz-stack"><Field id={'resolve-'+a.id} label="What was done (required)"><textarea id={'resolve-'+a.id} required maxLength={2000} value={note} disabled={busy} onChange={e=>setNote(e.target.value)}/></Field><div className="ob-actions"><Button variant="neutral" disabled={busy} onClick={()=>setResolving('')}>Cancel</Button><Button variant="primary" loading={busy} disabled={note.trim().length<3} onClick={()=>void resolve(a)}>Save as resolved</Button></div></div>}</article>)}
  {open&&<AccountsRecordDialog title="Flag reconciliation correction" onClose={()=>{if(!busy)setOpen(false);}}><Field id="correction-ipo" label="IPO number"><input id="correction-ipo" required pattern="[0-9]+" value={ipo} onChange={e=>setIpo(e.target.value)}/></Field><Field id="correction-message" label="Correction details"><textarea id="correction-message" required maxLength={3000} value={message} onChange={e=>setMessage(e.target.value)}/></Field>{error&&<p role="alert" className="form-error">{error}</p>}<Button variant="primary" loading={busy} disabled={!/^\d+$/.test(ipo)||message.trim().length<10} onClick={()=>void save()}>Flag for Accounts & Inventory</Button></AccountsRecordDialog>}</section>;
}
