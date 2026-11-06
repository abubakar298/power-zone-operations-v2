import {AccountsRecordDialog} from './AccountsRecordDialog.js';
import '../ui/accounts.css';
import {useState} from 'react';
import './evidence-preview.css';
import {Button} from '../ui/Button.js';
import {DocumentPreview} from './AccountsDocumentPreview.js';
/** Preview authenticated originals in place. Download remains an explicit action. */
export function EvidencePreview({url,title,filename,label}:{url:string;title:string;filename?:string;label?:string}){
 const [open,setOpen]=useState(false);
 return <div className="evidence-preview"><Button variant="neutral" aria-expanded={open} aria-label={label?`${label} ${title}`:undefined} onClick={()=>setOpen(v=>!v)}>{label??title}</Button>{open&&<AccountsRecordDialog title={title} onClose={()=>setOpen(false)}><DocumentPreview url={url} title={title} downloadFilename={filename} compactControls/></AccountsRecordDialog>}</div>;
}
