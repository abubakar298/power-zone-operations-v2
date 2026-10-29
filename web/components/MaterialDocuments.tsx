import {useEffect,useRef,useState} from 'react';
import {Button} from '../ui/Button.js';
import {DocumentPreview} from './DocumentPreview.js';
import './material-documents.css';

export type MaterialDocumentChoice={id:string;label:string;url:string};
export function MaterialDocuments({documents,disabled=false,openRequest=0,triggerLabel='Preview Documents'}:{documents:MaterialDocumentChoice[];disabled?:boolean;openRequest?:number;triggerLabel?:string}){
 const [open,setOpen]=useState(false),[selected,setSelected]=useState(''),dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLSpanElement>(null);
 const current=documents.find(d=>d.id===selected)??documents[0];
 useEffect(()=>{if(openRequest&&documents.length){setSelected(documents[0].id);setOpen(true);}},[openRequest]);
 useEffect(()=>{if(!open||!dialog.current)return;dialog.current.showModal();return()=>dialog.current?.close();},[open]);
 function close(){setOpen(false);trigger.current?.querySelector('button')?.focus();}
 return <><span ref={trigger}><Button variant="secondary" disabled={disabled||!documents.length} title={disabled?'Save changes before previewing this version.':undefined} onClick={()=>{setSelected(documents[0]?.id??'');setOpen(true);}}>{triggerLabel}</Button></span>{open&&<dialog ref={dialog} className="material-document-dialog" aria-labelledby="material-document-heading" onCancel={e=>{e.preventDefault();close();}}><header><div><h2 id="material-document-heading">Document preview</h2><p>Previewing or downloading documents does not change stock balances.</p></div><Button onClick={close}>Close preview</Button></header><label className="pz-field">Document<select value={current?.id??''} onChange={e=>setSelected(e.target.value)}>{documents.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select></label>{current&&<DocumentPreview key={current.url} url={current.url} title={current.label}/>}</dialog>}</>;
}
