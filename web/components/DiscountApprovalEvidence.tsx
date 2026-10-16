import {FileUpload} from '../ui/FileUpload.js';
import {useState} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
export type DiscountEvidence={id:string;filename:string};
export function DiscountApprovalEvidence({session,files,onChange}:{session:Session;files:DiscountEvidence[];onChange:(files:DiscountEvidence[])=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function upload(file?:File){
  if(!file||busy)return;
  if(files.length>=10||file.size>8388608||!['application/pdf','image/png','image/jpeg','text/plain'].includes(file.type)){setError('Attach up to 10 PDF, PNG, JPEG or text files, each up to 8 MB.');return;}
  setBusy(true);setError('');
  try{
   const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Unable to read file.'));reader.readAsDataURL(file);});
   const attachment=await api<DiscountEvidence>('/survey-uploads',{body:{filename:file.name,mime:file.type,base64:data.split(',')[1]},csrf:session.csrfToken});
   onChange([...files,attachment]);
  }catch(e){setError(e instanceof Error?e.message:'Upload failed. Try again.');}finally{setBusy(false);}
 }
 return <div className="pz-discount-evidence"><label className="pz-discount-upload">Attach Management discount approval<FileUpload attachments={files} onRemoveAttachment={file=>onChange(files.filter(other=>other.id!==file.id))} type="file" accept="application/pdf,image/png,image/jpeg,text/plain" disabled={busy} onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}}/></label><small>PDF, PNG, JPEG or text · Up to 10 files · 8 MB per file.</small>{busy&&<p role="status">Uploading approval evidence…</p>}{error&&<p role="alert" className="form-error">{error}</p>}<small>Evidence is linked when sent to Management. Uploading does not record approval.</small></div>;
}
