import {useEffect,useState} from 'react';
import {Button} from '../ui/Button.js';
export function WorkflowToast(){
 const [notice,setNotice]=useState<{message:string;sequence:number}|null>(null);
 useEffect(()=>{const receive=(event:any)=>setNotice({message:event.detail.message,sequence:Date.now()});window.addEventListener('pz:workflow-completed',receive);return()=>window.removeEventListener('pz:workflow-completed',receive);},[]);
 useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(null),6000);return()=>window.clearTimeout(timer);},[notice]);
 return <div className="pz-workflow-toast-region" aria-live="polite" aria-atomic="true">{notice&&<div className="pz-workflow-toast"><span aria-hidden="true">✓</span><span>{notice.message}</span><Button variant="neutral" aria-label="Dismiss notification" onClick={()=>setNotice(null)}>×</Button></div>}</div>;
}
