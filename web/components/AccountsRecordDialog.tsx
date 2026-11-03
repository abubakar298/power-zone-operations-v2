import {useEffect,useRef,type ReactNode} from 'react';
import {Button} from '../ui/Button.js';
export function AccountsRecordDialog({title,reference,subtitle,onClose,children,wide}:{title:string;reference?:string;subtitle?:string;onClose:()=>void;children:ReactNode;wide?:boolean}){
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{
  const previous=document.activeElement,dialog=ref.current;
  dialog?.showModal();
  return()=>{if(dialog?.open)dialog.close();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
 },[]);
 return <dialog ref={ref} className={wide?"accounts-record-dialog accounts-record-dialog--wide":"accounts-record-dialog"} aria-label={title} onCancel={event=>{event.preventDefault();onClose();}}><header className="accounts-dialog-heading"><div>{reference&&<span className="accounts-record-reference">{reference}</span>}<h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><Button variant="neutral" aria-label="Close record" onClick={onClose}>×</Button></header><div className="accounts-dialog-body">{children}</div></dialog>;
}
