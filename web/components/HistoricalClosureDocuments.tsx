import {useState} from 'react';
import {api,type Session} from '../api.js';
import {Field} from '../ui/Field.js';
import {FileUpload} from '../ui/FileUpload.js';
import {EvidencePreview} from './EvidencePreview.js';
const kinds=['PT costing screenshot','Signed DO','Variable items sign-off','Client acknowledgment','Site photographs'];
/** Append supporting evidence; never edits submitted financial snapshots. */
export function HistoricalClosureDocuments({session,job,onUploaded}:{session:Session;job:any;onUploaded:()=>Promise<void>}){
 const [kind,setKind]=useState(kinds[0]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const evidence=job.evidence??[],missing=kinds.filter(k=>!evidence.some((e:any)=>e.kind===k||k==='Variable items sign-off'&&e.kind==='IRR'));
 async function upload(file:File){
  if(busy)return;setBusy(true);setError('');setNotice('');
  try{const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Unable to read the selected document.'));reader.readAsDataURL(file);});await api('/accounts-workspace/jobs/'+encodeURIComponent(job.jobKey)+'/supplementary-evidence',{csrf:session.csrfToken,body:{kind,filename:file.name,mediaType:file.type,base64}});await onUploaded();setNotice('Supporting file added. Submitted costs and approval history are unchanged.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <section className="detail-panel pz-stack"><h3>Historical supporting documents</h3><p>Approved historical exception: missing supporting documents and the PT report may be attached later. Complete costing and PT confirmation are still required for submission. Photographs are for invoicing.</p>
  <p role="status">{missing.length?'Still to attach: '+missing.join(', '):'All supporting document types are available.'}</p>
  <div className="pz-form-grid"><Field id="historical-closure-file-kind" label="Document type"><select id="historical-closure-file-kind" disabled={busy} value={kind} onChange={e=>setKind(e.target.value)}>{kinds.map(k=><option key={k}>{k}</option>)}</select></Field><Field id="historical-closure-file" label="Add supporting file" hint="PDF, PNG or JPEG · maximum 8 MB"><FileUpload id="historical-closure-file" type="file" accept={kind==='Site photographs'?'image/png,image/jpeg':'application/pdf,image/png,image/jpeg'} disabled={busy} onChange={e=>{if(e.target.files?.[0])void upload(e.target.files[0]);}}/></Field></div>
  {busy&&<p role="status">Uploading supporting file…</p>}{error&&<p role="alert" className="form-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {evidence.filter((e:any)=>e.kind==='PT costing screenshot').map((e:any)=><EvidencePreview key={e.id} url={e.downloadUrl??'/api/accounts-workspace/evidence/'+e.id} title={e.filename} filename={e.filename}/>)}
 </section>;
}
