import {useEffect,useId,useRef,useState} from 'react';
import {Button} from '../ui/Button.js';
import {Icon} from './Icon.js';
import {canViewDepartments,managementDepartment,managementDepartments,type ManagementDepartment} from '../workspaces/management-departments.js';

export function DepartmentViewSwitcher({role,value,onSelect,busy=false,error=''}:{role:string;value?:ManagementDepartment;onSelect:(view:ManagementDepartment|'dashboard')=>boolean|Promise<boolean>;busy?:boolean;error?:string}){
 const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),id=useId();
 useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
 if(!canViewDepartments(role))return null;
 const choose=async(view:ManagementDepartment|'dashboard')=>{if(await onSelect(view))setOpen(false);};
 return <div ref={root} className="pz-department-switcher" onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);root.current?.querySelector<HTMLButtonElement>('button')?.focus();}}}>
  <Button variant="neutral" loading={busy} loadingLabel="Opening…" title={value?`Current view: ${managementDepartment(value)?.label}`:'Open a department workspace'} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}>View as<Icon name="chevron"/></Button>
  {open&&<nav id={id} className="pz-department-switcher-menu" aria-label="View department workspace">
   <Button disabled={busy} variant={value?'neutral':'secondary'} onClick={()=>void choose('dashboard')}>Management</Button>
   {managementDepartments.map(d=><Button disabled={busy} key={d.view} variant={value===d.view?'secondary':'neutral'} aria-current={value===d.view?'page':undefined} onClick={()=>void choose(d.view)}>{d.label}</Button>)}
   {error&&<p className="form-error" role="alert">{error}</p>}
  </nav>}
 </div>;
}
