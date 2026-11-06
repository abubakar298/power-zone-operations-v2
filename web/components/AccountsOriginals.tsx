import './site-documents.css';
import {useState} from 'react';
import {api} from '../api.js';
import {Button} from '../ui/Button.js';
import {Field} from '../ui/Field.js';
import {StatusBadge} from '../ui/StatusBadge.js';
import {AccountsRecordDialog} from './AccountsRecordDialog.js';
import {displayDate} from './SiteDocumentsDialog.js';

const location=(value:string)=>({'At site':'At site','With delivery driver':'With delivery driver','Received at Lahore head office':'Lahore office','TCS to Karachi office':'In transit to Karachi','TCS to Lahore head office':'In transit to Lahore','Received at Karachi office':'Karachi office','Submitted to Accounts':'Handed over to Accounts'}[value]??value);

/** Required originals past the three-day Karachi deadline, plus sites missing the start date. */
export function OverdueOriginals({sites}:{sites:any[]}){
 const overdue=sites.flatMap(s=>s.originals.overdue.map((i:any)=>({...i,site:s}))).sort((a,b)=>b.daysOverdue-a.daysOverdue||String(a.site.name).localeCompare(String(b.site.name)));
 const missingDate=sites.filter(s=>s.originals.missingStartDate);
 if(!overdue.length&&!missingDate.length)return null;
 return <section className="accounts-list-panel"><header className="accounts-panel-heading"><div><h2>Overdue physical originals</h2><p>Required originals must reach the Karachi office within three calendar days of the Job Completion Date (QC), or the final delivery date for delivery-only sites.</p></div><span>{overdue.length} {overdue.length===1?'original':'originals'}</span></header>
  {overdue.length>0&&<div className="pz-table-scroll"><table className="site-documents-table"><thead><tr><th>SR#</th><th>Site / customer</th><th>Document</th><th>Completion / final delivery</th><th>Current location</th><th>Days overdue</th><th>Dispatch / tracking</th></tr></thead><tbody>{overdue.map((i:any,n:number)=><tr key={i.site.id+i.key}><td>{n+1}</td><td><strong>{i.site.name}</strong><small>{i.site.customer||'Customer not recorded'} · {i.site.ipo}</small></td><td><strong>{i.type}</strong><small>{i.batchLabel}</small></td><td>{displayDate(i.site.originals.startDate)}<small>{i.site.originals.startBasis}</small></td><td><strong>{location(i.location)}</strong>{i.status==='karachi-pending'&&<small>Accounts confirmation pending</small>}</td><td><StatusBadge tone="danger">{i.daysOverdue} {i.daysOverdue===1?'day':'days'}</StatusBadge></td><td>{i.tracking?`TCS ${i.tracking}`:i.carrier?i.carrier:'Not recorded'}{i.tracking&&i.carrier&&<small>{i.carrier}</small>}</td></tr>)}</tbody></table></div>}
  {missingDate.length>0&&<p role="status" className="pz-caption">{missingDate.length} {missingDate.length===1?'site has':'sites have'} no recorded completion or final delivery date, so no deadline is set: {missingDate.map(s=>s.name).join(', ')}.</p>}
 </section>;
}

/** Salaas confirms only the originals actually received, with their receipt date. */
export function ConfirmReceiptDialog({site,onClose,onSaved}:{site:any;onClose:()=>void;onSaved:(message:string)=>void|Promise<void>}){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const pending=site.originals.items.filter((i:any)=>i.status==='karachi-pending'||i.status==='lahore-pending');
 const [chosen,setChosen]=useState<string[]>([]),[date,setDate]=useState(today),[saving,setSaving]=useState(false),[error,setError]=useState(''),[requestKey]=useState(()=>crypto.randomUUID());
 async function save(){if(saving)return;setSaving(true);setError('');try{const session=await api<any>('/auth/session');await api(`/accounts-workspace/sites/${encodeURIComponent(site.id)}/original-receipts`,{csrf:session.csrfToken,body:{siteVersion:site.version,items:chosen,receivedOn:date,requestKey}});await onSaved(`${chosen.length} ${chosen.length===1?'original':'originals'} confirmed received for ${site.name} on ${displayDate(date)}. They are now Handed over to Accounts.`);}catch(e){setError((e as Error).message);}finally{setSaving(false);}}
 return <AccountsRecordDialog title="Confirm Receipt" reference={site.ipo} subtitle={site.name} onClose={()=>{if(!saving)onClose();}}>
  <form className="accounts-record-section" onSubmit={e=>{e.preventDefault();void save();}}>
   <p>Select only the originals you actually received at the Karachi office or the Lahore head office. Others stay pending.</p>
   {pending.length?<div className="pz-table-scroll"><table className="site-documents-table"><thead><tr><th>Received</th><th>SR#</th><th>Original</th><th>Reported at office</th></tr></thead><tbody>{pending.map((i:any,n:number)=><tr key={i.key}><td><input type="checkbox" aria-label={`Received ${i.type} · ${i.batchLabel}`} checked={chosen.includes(i.key)} disabled={saving} onChange={e=>setChosen(c=>e.target.checked?[...c,i.key]:c.filter(k=>k!==i.key))}/></td><td>{n+1}</td><td><strong>{i.type}</strong><small>{i.batchLabel}</small></td><td>{displayDate(i.locationDate)}<small>{i.status==='lahore-pending'?'Lahore head office':'Karachi office'}</small>{i.tracking&&<small>TCS {i.tracking}</small>}</td></tr>)}</tbody></table></div>:<p>No originals are waiting for Accounts confirmation at the Karachi office or the Lahore head office.</p>}
   <Field id="original-receipt-date" label="Receipt date"><input id="original-receipt-date" type="date" required max={today} value={date} onChange={e=>setDate(e.target.value)} disabled={saving}/></Field>
   {error&&<p role="alert" className="form-error">{error}</p>}
   <div className="site-documents-actions"><Button variant="primary" type="submit" disabled={saving||!chosen.length||!date}>{saving?'Saving…':'Confirm Receipt'}</Button><Button variant="neutral" type="button" disabled={saving} onClick={onClose}>Cancel</Button></div>
  </form>
 </AccountsRecordDialog>;
}
