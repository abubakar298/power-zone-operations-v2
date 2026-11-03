import './site-documents.css';
import {useEffect,useState} from 'react';
import {api} from '../api.js';
import {Button} from '../ui/Button.js';
import {StatusBadge} from '../ui/StatusBadge.js';
import {AccountsRecordDialog} from './AccountsRecordDialog.js';
import {EvidencePreview} from './EvidencePreview.js';
import {downloadDepartmentFile} from '../download-file.js';

type FileRow={id:string;name:string;url:string;label?:string;date?:string|null;mediaType?:string};
export const displayDate=(value?:string|null)=>/^\d{4}-\d{2}-\d{2}$/.test(value??'')?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z')):'Not recorded';

/** Existing signed documents and QC pictures for one site; previews open in place and
 * download is a separate action. No new upload is requested. */
export function SiteDocumentsDialog({siteId,title,reference,onClose}:{siteId:string;title:string;reference?:string;onClose:()=>void}){
 const [data,setData]=useState<any>(),[error,setError]=useState('');
 useEffect(()=>{let active=true;api<any>(`/accounts-workspace/sites/${encodeURIComponent(siteId)}/evidence`).then(v=>{if(active)setData(v);}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[siteId]);
 return <AccountsRecordDialog title={title} reference={reference} subtitle="Site documents" wide onClose={onClose}>
  {error&&<p role="alert" className="form-error">{error}</p>}
  {!data&&!error&&<p role="status">Loading site documents…</p>}
  {data&&<>
   <DocumentList heading="Signed DOs" files={data.signedDos} empty="No signed DO has been uploaded by QC."/>
   <DocumentList heading="VSO (variable items sign-off)" files={data.vso} empty={data.vsoNotRequired?'Not required: QC confirmed no variable items were used.':'No VSO has been uploaded by QC.'}/>
   <DocumentList heading="Customer acknowledgment" files={data.acknowledgments} empty="No customer acknowledgment has been uploaded by QC."/>
   <section className="accounts-record-section"><h3>QC pictures</h3>{data.pictureGroups.length?data.pictureGroups.map((g:any)=><div key={g.key} className="site-documents-group"><div className="site-documents-group-heading"><strong>{g.stage}</strong><small>{g.kind==='delivery'?'Delivery':'Installation'} · {displayDate(g.date)}</small></div><div className="site-documents-pictures">{g.files.map((f:FileRow)=><FileActions key={f.id} file={f}/>)}</div></div>):<p>No QC pictures have been uploaded.</p>}</section>
   {data.otherDocuments.length>0&&<DocumentList heading="Other site documents" files={data.otherDocuments} empty=""/>}
   <OriginalsSummary originals={data.originals}/>
  </>}
 </AccountsRecordDialog>;
}
function DocumentList({heading,files,empty}:{heading:string;files:FileRow[];empty:string}){
 return <section className="accounts-record-section"><h3>{heading}</h3>{files.length?<div className="pz-table-scroll"><table className="site-documents-table"><thead><tr><th>SR#</th><th>Document</th><th>Date</th><th>Action</th></tr></thead><tbody>{files.map((f,i)=><tr key={f.id}><td>{i+1}</td><td><strong>{f.label??f.name}</strong><small>{f.name}</small></td><td>{displayDate(f.date)}</td><td><FileActions file={f} compact/></td></tr>)}</tbody></table></div>:<p>{empty}</p>}</section>;
}
function FileActions({file,compact}:{file:FileRow;compact?:boolean}){
 const [error,setError]=useState('');
 return <div className={compact?'site-documents-actions':'site-documents-picture'}>{!compact&&<small>{file.name}</small>}<div className="site-documents-actions"><EvidencePreview url={file.url} title={file.name} label={compact?'Preview':undefined} filename={file.name}/><Button variant="neutral" onClick={()=>{setError('');void downloadDepartmentFile(file.url,file.name).catch(e=>setError((e as Error).message));}}>Download</Button></div>{error&&<small role="alert" className="form-error">{error}</small>}</div>;
}
/** Physical originals: Karachi arrival reported by QC is not Accounts custody. */
export function OriginalsSummary({originals}:{originals:any}){
 if(!originals)return null;
 const tone=(status:string)=>status==='confirmed'||status==='legacy-handover'?'success':status==='karachi-pending'?'warning':'pending';
 return <section className="accounts-record-section"><div className="accounts-panel-heading"><h3>Physical originals</h3><span>{originals.missingStartDate?<StatusBadge tone="danger">{originals.startBasis} missing</StatusBadge>:originals.dueDate?`Due at Karachi office ${displayDate(originals.dueDate)}`:'Deadline starts at job completion'}</span></div>
  {originals.items.length?<div className="pz-table-scroll"><table className="site-documents-table"><thead><tr><th>SR#</th><th>Original</th><th>Status</th><th>Received</th></tr></thead><tbody>{originals.items.map((i:any,n:number)=><tr key={i.key}><td>{n+1}</td><td><strong>{i.type}</strong><small>{i.batchLabel}</small></td><td><StatusBadge tone={i.overdue?'danger':tone(i.status)}>{i.overdue?`Overdue ${i.daysOverdue} ${i.daysOverdue===1?'day':'days'}`:i.statusLabel}</StatusBadge>{i.overdue&&<small>{i.statusLabel}</small>}{i.tracking&&<small>TCS {i.tracking}</small>}</td><td>{i.receivedOn?displayDate(i.receivedOn):'—'}{i.receivedLate&&<small>{i.daysLate} {i.daysLate===1?'day':'days'} late</small>}</td></tr>)}</tbody></table></div>:<p>No physical originals are recorded for this site yet.</p>}
  {originals.missing.length>0&&<p className="pz-caption">Still missing: {originals.missing.map((i:any)=>i.type).join(', ')}.</p>}
 </section>;
}
