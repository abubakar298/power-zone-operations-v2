import {useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {Field} from '../ui/Field.js';
import {Button} from '../ui/Button.js';
import {useUnsavedChanges} from '../hooks/useUnsavedChanges.js';
const customerFields=[['name','Customer name'],['short_code','Customer short code'],['contact_person','Customer contact person'],['phone','Customer contact number'],['email','Customer email'],['address','Customer billing address']] as const;
const siteFields=[['name','Site name'],['code','Branch / site code'],['location','Site address'],['contact_person','Site contact person'],['contact_phone','Site contact number']] as const;
export function QuotationCustomerDetails({session,workflowId,onDirty}:{session:Session;workflowId:string;onDirty:(dirty:boolean)=>void}){
 const [master,setMaster]=useState<any>();const [customer,setCustomer]=useState<any>({});const [site,setSite]=useState<any>({});
 const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useUnsavedChanges(dirty);
 async function load(){const detail=await api<any>(`/project-workflow/${workflowId}`);const m=detail.masterReview;setMaster(m);setCustomer(Object.fromEntries(customerFields.map(([key])=>[key,m.customer[key]??''])));setSite(Object.fromEntries(siteFields.map(([key])=>[key,m.site[key]??''])));setDirty(false);onDirty(false);}
 useEffect(()=>{onDirty(true);void load().catch(e=>setError(e.message));},[workflowId]);
 async function save(){
  const changes=[...customerFields.filter(([k])=>String(master.customer[k]??'')!==customer[k]).map(([k,label])=>`${label}: ${master.customer[k]||'Not entered'} → ${customer[k]||'Not entered'}`),...siteFields.filter(([k])=>String(master.site[k]??'')!==site[k]).map(([k,label])=>`${label}: ${master.site[k]||'Not entered'} → ${site[k]||'Not entered'}`)].join('\n');
  if(!window.confirm(`Review changes to the linked customer and site:\n\n${changes}\n\nContinue to database confirmation?`))return;
  if(!window.confirm('Final confirmation: these changes will update the main customer and site database and affect future documents. Existing document snapshots will remain unchanged. Save these changes?'))return;
  setBusy(true);setError('');setNotice('');
  try{await api(`/project-workflow/${workflowId}/quotation-master-details`,{csrf:session.csrfToken,body:{customerVersion:master.customer.version,siteVersion:master.site.version,reviewConfirmed:true,databaseConfirmed:true,customer,site}});await load();setNotice('Customer and site database details updated.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 if(!master)return <div><p>Loading linked customer details…</p>{error&&<p className="form-error" role="alert">{error}</p>}</div>;
 const edit=(kind:'customer'|'site',key:string,value:string)=>{(kind==='customer'?setCustomer:setSite)((current:any)=>({...current,[key]:value}));setDirty(true);onDirty(true);setNotice('');};
 return <><p>Project information received: technically reviewed survey report and solution inputs.</p><input type="hidden" name="customerId" value={master.customer.id}/><div className="pz-form-grid">{customerFields.map(([key,label])=><Field key={key} id={`quote-customer-${key}`} label={label}><input id={`quote-customer-${key}`} data-missing-check={true} data-original-value={String(master.customer[key]??'')} type={key==='email'?'email':'text'} value={customer[key]} disabled={busy} maxLength={key==='name'?200:key==='short_code'?30:key==='phone'?100:key==='email'?254:2000} required={key==='name'||key==='short_code'} onChange={e=>edit('customer',key,e.target.value)}/></Field>)}</div><hr className="pz-survey-form-divider"/><div className="pz-form-grid">{siteFields.map(([key,label])=><Field key={key} id={`quote-site-${key}`} label={label}><input id={`quote-site-${key}`} data-missing-check={true} data-original-value={String(master.site[key]??'')} name={key==='name'?'siteName':key==='code'?'siteCode':key==='location'?'location':undefined} value={site[key]} disabled={busy} required={key==='name'||key==='code'} maxLength={key==='name'?200:key==='code'?30:key==='contact_phone'?100:2000} onChange={e=>edit('site',key,e.target.value)}/></Field>)}</div>{dirty&&<div><Button variant="primary" loading={busy} onClick={()=>void save()}>Review & Save Customer Details</Button>{error&&<p className="form-error" role="alert">{error}</p>}<p>Confirm these database changes before saving or calculating the BOQ.</p></div>}{notice&&<p role="status">{notice}</p>}</>;
}
