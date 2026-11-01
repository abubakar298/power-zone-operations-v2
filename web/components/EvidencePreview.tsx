import {useState} from 'react';
import './evidence-preview.css';
import {Button} from '../ui/Button.js';
import {DocumentPreview} from './AccountsDocumentPreview.js';
/** Preview authenticated originals in place. Download remains an explicit action. */
export function EvidencePreview({url,title,filename}:{url:string;title:string;filename?:string}){
 const [open,setOpen]=useState(false);
 return <div className="evidence-preview"><Button variant="neutral" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{title}</Button>{open&&<><Button variant="neutral" onClick={()=>setOpen(false)}>Close preview</Button><DocumentPreview url={url} title={title} downloadFilename={filename} compactControls/></>}</div>;
}
