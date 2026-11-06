import {useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {Field} from '../ui/Field.js';
import {AccountsRecordDialog} from './AccountsRecordDialog.js';
export function MaterialCorrectionAlerts({session,inventory=false}:{session:Session;inventory?:boolean}){
 const [alerts,setAlerts]=useState<any[]>(),[error,setError]=useState(''),[open,setOpen]=useState(false),[ipo,setIpo]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const owner=['Admin','Management'].includes(session.user.role),path=inventory?'/material-dispatches/material-corrections':'/accounts-workspace/material-corrections';
 async function load(){try{setAlerts((await api<any>(path)).alerts);setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[path]);
 async function save(){if(busy)return;setBusy(true);setError('');try{await api('/accounts-workspace/material-corrections',{csrf:session.csrfToken,body:{ipoNumber:ipo,message,requestKey:crypto.randomUUID()}});setOpen(false);setIpo('');setMessage('');await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 if(!alerts?.length&&!owner&&!error)return null;
 return <section className="pz-panel pz-stack"><div className="ob-section-title"><div><h2>Reconciliation corrections{alerts?.length?' · '+alerts.length:''}</h2><p>Accounts and Inventory must review these quantity discrepancies. Closed jobs and posted stock remain unchanged.</p></div>{owner&&!inventory&&<Button variant="secondary" onClick={()=>setOpen(true)}>Flag reconciliation correction</Button>}</div>{error&&!open&&<p role="alert" className="form-error">{error}</p>}{alerts?.map(a=><div key={a.id}><strong>{a.site_name} · CHP-{a.legacy_ipo_number}</strong><p>{a.message}</p></div>)}{open&&<AccountsRecordDialog title="Flag reconciliation correction" onClose={()=>{if(!busy)setOpen(false);}}><Field id="correction-ipo" label="IPO number"><input id="correction-ipo" required pattern="[0-9]+" value={ipo} onChange={e=>setIpo(e.target.value)}/></Field><Field id="correction-message" label="Correction details"><textarea id="correction-message" required maxLength={3000} value={message} onChange={e=>setMessage(e.target.value)}/></Field>{error&&<p role="alert" className="form-error">{error}</p>}<Button variant="primary" loading={busy} disabled={!/^\d+$/.test(ipo)||message.trim().length<10} onClick={()=>void save()}>Flag for Accounts & Inventory</Button></AccountsRecordDialog>}</section>;
}
