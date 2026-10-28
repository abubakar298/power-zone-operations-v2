import {useEffect,useRef,useState} from 'react';
import {Icon} from './Icon.js';
/** Shared compact account anchor keeps View as in a stable adjacent header slot. */
export function WorkspaceAccountMenu({name,label,onSignOut,disabled=false}:{name:string;label:string;onSignOut:()=>void;disabled?:boolean}){
 const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[open]);
 return <div className="account ob-account" ref={root} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);root.current?.querySelector<HTMLButtonElement>('button')?.focus();}}}><button className="account-trigger" type="button" aria-label="Account menu" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(!open)}><span className="avatar">{name.split(/\s+/).map(n=>n[0]).slice(0,2).join('')}</span><span className="ob-account-name"><strong>{name}</strong><small>{label}</small></span><Icon name="chevron"/></button>{open&&<div className="account-menu" role="menu"><button role="menuitem" disabled={disabled} onClick={onSignOut}>Sign out</button></div>}</div>;
}
