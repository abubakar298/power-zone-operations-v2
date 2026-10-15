import {useEffect,useRef,useState} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {Field} from '../ui/Field.js';
export function UblCustomerSend({session,pkg}:{session:Session;pkg:any}){
 const [data,setData]=useState<any>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState<File[]>([]),[recipient,setRecipient]=useState('UBL'),[notes,setNotes]=useState('Reviewed report and UBL Excel sent to the customer.'),[notice,setNotice]=useState('');
 const input=useRef<HTMLInputElement>(null),sendKey=useRef<string>('');
 const path=`/project-workflow/ubl-survey-packages/${pkg.id}`;
 async function load(){setData(await api<any>(path+'/sending-evidence'));}
 useEffect(()=>{void load().catch(e=>setError(e.message));},[pkg.id]);
 const firstId=pkg.snapshot.sites[0].recordId;
 return <section className="pz-panel pz-stack">
  <h4>{pkg.snapshot.sites.length > 1 ? 'Group Sending Evidence' : 'Customer Sending Evidence'}</h4>
  <p className="pz-caption">Attach the email or delivery evidence for this report and Excel. One send action marks every site in this package sent together and moves them to Customer Follow-up.</p>
  <p role="status">Attached files ({data?.files?.length??0}){data?.sent?' · Sent to Customer':''}</p>
  {data?.files?.length>0&&<div className="pz-table-scroll"><table className="pz-table"><thead><tr><th>File name</th><th>Action</th></tr></thead><tbody>{data.files.map((f:any)=><tr key={f.id}><td><a target="_blank" rel="noreferrer" href={`/api/project-workflow/${firstId}/files/${f.id}`}>{f.filename}</a></td><td>{!data.sent&&<Button variant="danger" disabled={busy} onClick={async()=>{if(!window.confirm(`Remove “${f.filename}” from this package's sending evidence? The audit copy is retained.`))return;setBusy(true);setError('');try{await api(path+`/sending-evidence/${f.id}/remove`,{csrf:session.csrfToken,body:{}});await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Remove</Button>}</td></tr>)}</tbody></table></div>}
  {!data?.sent&&<>
   <Field id={`customer-send-files-${pkg.id}`} label="Attach sending evidence" hint="Select multiple PDF, PNG or JPEG files · maximum 8 MB each"><input ref={input} id={`customer-send-files-${pkg.id}`} type="file" multiple accept="application/pdf,image/png,image/jpeg" disabled={busy} onChange={e=>{setSelected(Array.from(e.target.files??[]));setError('');}}/></Field>
   {selected.length>0&&<p>{selected.length} selected: {selected.map(f=>f.name).join(', ')}</p>}
   <div><Button variant="secondary" loading={busy} disabled={!selected.length} onClick={async()=>{setError('');setBusy(true);let uploaded=0;try{for(const file of selected){if(file.size>8388608)throw Error('Each file must be 8 MB or smaller.');const base64=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('Unable to read '+file.name));r.readAsDataURL(file);});await api(path+'/sending-evidence',{csrf:session.csrfToken,body:{filename:file.name,mime:file.type,base64}});uploaded++;}setSelected([]);if(input.current)input.current.value='';setNotice(`${uploaded} file${uploaded===1?'':'s'} attached.`);}catch(e){setSelected(selected.slice(uploaded));setError((e as Error).message);}finally{await load().catch(e=>setError(e.message));setBusy(false);}}}>Attach Files</Button></div>
   <div className="pz-form-grid"><Field id={`customer-recipient-${pkg.id}`} label="Customer / recipient"><input id={`customer-recipient-${pkg.id}`} value={recipient} onChange={e=>{setRecipient(e.target.value);sendKey.current='';}}/></Field><Field id={`customer-notes-${pkg.id}`} label="Sending remarks"><textarea id={`customer-notes-${pkg.id}`} value={notes} onChange={e=>{setNotes(e.target.value);sendKey.current='';}}/></Field></div>
   <div><Button variant="primary" loading={busy} disabled={!data} onClick={async()=>{setError('');if(!data?.files?.length){setError('Attach customer sending evidence before submitting.');return;}if(!window.confirm(`Approve and record sending this report and UBL Excel for ${pkg.snapshot.sites.length} sites to ${recipient}? They will move to Customer Follow-up. Existing review flags remain recorded.`))return;setBusy(true);try{sendKey.current ||=crypto.randomUUID();await api(path+'/send-to-customer',{csrf:session.csrfToken,body:{requestKey:sendKey.current,confirmed:true,recipient,notes,versions:data.versions}});await load();setNotice('Sent to Customer — moved to Customer Follow-up.');window.dispatchEvent(new CustomEvent('pz:workflow-completed',{detail:{message:'Sent to Customer — moved to Customer Follow-up.'}}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Send to Customer</Button></div>
  </>}
  {notice&&<p role="status">{notice}</p>}{error&&<p className="form-error" role="alert">{error}</p>}
 </section>;
}
