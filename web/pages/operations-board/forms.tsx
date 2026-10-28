import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {api,type Session} from '../../api.js';
import {downloadDepartmentFile} from '../../download-file.js';
import {Button} from '../../ui/Button.js';
import {FileUpload} from '../../ui/FileUpload.js';
import {useUnsavedChanges} from '../../hooks/useUnsavedChanges.js';
import type {Evidence} from './types.js';
export function useSave(session:Session){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const request=useRef<{signature:string;key:string}|null>(null),pending=useRef(false);
 async function save<T>(path:string,payload:Record<string,unknown>,done:(value:T)=>void){
  if(pending.current)return false;
  pending.current=true;setBusy(true);setError('');
  const signature=JSON.stringify([path,payload]);if(request.current?.signature!==signature)request.current={signature,key:crypto.randomUUID()};
  try{const result=await api<T>(path,{csrf:session.csrfToken,body:{...payload,requestKey:request.current.key}});done(result);return true;}catch(e){setError((e as Error).message);return false;}finally{pending.current=false;setBusy(false);}
 }
 return {busy,error,setError,save};
}
export function Editor({dirty,children,onCancel,onSubmit,busy,error,label='Save',reason,onReason}:{dirty:boolean;children:ReactNode;onCancel:()=>void;onSubmit:()=>void;busy:boolean;error:string;label?:string;reason?:string;onReason?:(value:string)=>void}){
 useUnsavedChanges(dirty);
 return <form className="ob-editor pz-stack" onSubmit={e=>{e.preventDefault();onSubmit();}}>
  <fieldset disabled={busy}>{children}{onReason&&<label>Reason for this change<textarea required value={reason??''} onChange={e=>onReason(e.target.value)} maxLength={2000}/></label>}</fieldset>
  {error&&<p className="form-error" role="alert">{error}</p>}
  <div className="ob-actions"><Button variant="primary" type="submit" loading={busy} loadingLabel="Saving…">{label}</Button><Button variant="neutral" disabled={busy} onClick={onCancel}>Cancel</Button></div>
 </form>;
}
export function Section({title,children,action}:{title:string;children:ReactNode;action?:ReactNode}){return <section className="pz-panel pz-stack"><header className="ob-section-title"><h2>{title}</h2>{action}</header>{children}</section>;}
export function EvidencePicker({session,siteId,label,value,onChange,multiple=false,onBusy,downloadUrl,existingFiles=[]}:{session:Session;siteId:string;label:string;value:Evidence[];onChange:(files:Evidence[])=>void;multiple?:boolean;onBusy?:(busy:boolean)=>void;downloadUrl?:(file:Evidence)=>string;existingFiles?:Evidence[]}){
 const pickerId=useId(),input=useRef<HTMLInputElement>(null);
 const [selected,setSelected]=useState<File[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function upload(files:File[]){
  if(!files.length)return;setBusy(true);onBusy?.(true);setError('');
  try{
   let uploaded:Evidence[]=multiple?[...value]:[];
   for(let n=0;n<files.length;n++){const file=files[n];
    if(!file.size||file.size>25*1024*1024)throw Error('Choose a supported PDF or image up to 25 MB.');
    const base64=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('The file could not be read.'));r.readAsDataURL(file);});
    const result=await api<Evidence>(`/operations-board/sites/${encodeURIComponent(siteId)}/files`,{csrf:session.csrfToken,body:{filename:file.name,mediaType:file.type,base64}});if(!uploaded.some(f=>f.id===result.id))uploaded.push(result);if(mounted.current){onChange([...uploaded]);setSelected(files.slice(n+1));}
   }
   if(mounted.current){setSelected([]);if(input.current)input.current.value='';}
  }catch(e){if(mounted.current)setError((e as Error).message);}finally{if(mounted.current){setBusy(false);onBusy?.(false);}}
 }
 return <div className="pz-field ob-evidence"><label htmlFor={pickerId}>{label}</label><FileUpload ref={input} id={pickerId} aria-label={label} disabled={busy} multiple={multiple} accept="application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif" selectedFiles={selected} attachments={value.map(f=>({id:f.id,filename:f.name}))} onRemoveAttachment={file=>onChange(value.filter(f=>f.id!==file.id))} onChange={e=>{const files=Array.from(e.currentTarget.files??[]);setSelected(files);void upload(files);}}/>{existingFiles.length>0&&<label>Use an uploaded site file<select disabled={busy} value="" onChange={e=>{const file=existingFiles.find(f=>f.id===e.target.value);if(file){setError('');setSelected([]);if(input.current)input.current.value='';onChange(multiple?[...value.filter(f=>f.id!==file.id),file]:[file]);}}}><option value="">Choose existing evidence</option>{existingFiles.map(file=><option key={file.id} value={file.id}>{file.name}</option>)}</select></label>}{downloadUrl&&<EvidenceLinks siteId={siteId} files={value} downloadUrl={downloadUrl}/>}{busy&&<small role="status">Uploading evidence…</small>}{error&&<><small className="form-error" role="alert">{error}</small><Button variant="neutral" onClick={()=>void upload(selected)}>Retry upload</Button></>}</div>;
}
export function EvidenceLinks({siteId,files,downloadUrl}:{siteId:string;files:Evidence[];downloadUrl?:(file:Evidence)=>string}){
 const [error,setError]=useState('');
 async function download(file:Evidence){try{setError('');await downloadDepartmentFile(downloadUrl?.(file)??`/api/operations-board/sites/${encodeURIComponent(siteId)}/files/${encodeURIComponent(file.id)}`,file.name);}catch(e){setError((e as Error).message);}}
 return <div className="ob-file-links">{[...new Map(files.map(file=>[file.id,file])).values()].map(file=><Button variant="secondary" key={file.id} onClick={()=>void download(file)}>{file.name}</Button>)}{error&&<p role="alert" className="form-error">{error}</p>}</div>;
}
