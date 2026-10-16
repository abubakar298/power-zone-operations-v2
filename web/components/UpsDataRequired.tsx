import {Fragment,useEffect,useState,type FormEvent} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {Field} from '../ui/Field.js';

export function UpsDataRequired({customer,onSaved}:{customer:'UBL'|'MBL',onSaved:()=>Promise<void>}){
 const [data,setData]=useState<any>(),[search,setSearch]=useState(''),[editing,setEditing]=useState<any>(),[values,setValues]=useState<any>(),[notes,setNotes]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[saving,setSaving]=useState(false),[loading,setLoading]=useState(false);
 async function load(){setLoading(true);try{setData(await api(`/director/ups-data-review?customer=${customer}`));}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{setData(undefined);setEditing(undefined);setError('');setNotice('');void load();},[customer]);
 function edit(row:any){setEditing(row);setValues({...row.values});setNotes(row.notes);setError('');setNotice('');}
 function change(key:string,value:string|null){setValues((old:any)=>({...old,[key]:value}));}
 async function save(e:FormEvent){e.preventDefault();if(saving)return;setSaving(true);setError('');setNotice('');try{
  const session=await api<Session>('/auth/session');
  const result=await api<any>('/director/ups-data-review',{csrf:session.csrfToken,body:{programKey:editing.programKey,expectedVersion:editing.expectedVersion,orderNumber:editing.orderNumber,values,notes}});
  setEditing(undefined);setValues(undefined);setNotice(`${editing.orderNumber} saved${result.row?.status?` · ${result.row.status}`:''}.`);await load();await onSaved();
 }catch(e){setError((e as Error).message);}finally{setSaving(false);}}
 const text=(key:string,label:string,type='text')=><Field key={key} id={`ups-review-${key}`} label={label}><input id={`ups-review-${key}`} type={type} value={values?.[key]??''} onInput={type==='date'?e=>change(key,e.currentTarget.value||null):undefined} onChange={e=>change(key,type==='date'?e.target.value||null:e.target.value)} {...(type==='number'?{min:0,step:'0.01'}:{})}/></Field>;
 const select=(key:string,label:string,options:string[])=><Field key={key} id={`ups-review-${key}`} label={label}><select id={`ups-review-${key}`} value={values?.[key]} onChange={e=>change(key,e.target.value)}>{options.map(option=><option key={option}>{option}</option>)}</select></Field>;
 if(!data&&!error)return null;
 if(data?.total===0)return null;
 const rows=(data?.rows??[]).map((r:any,i:number)=>({...r,sr:i+1})).filter((r:any)=>[r.siteName,r.orderNumber,r.status,...r.missing].join(' ').toLowerCase().includes(search.toLowerCase()));
 return <section className="pz-panel pz-stack" aria-label="UPS Data Required">
  <div className="pz-action-row"><h3>Data Required · {data?.required??'—'} Sites</h3><Button variant="neutral" loading={loading} loadingLabel="Refreshing…" disabled={saving} onClick={()=>void load()}>Refresh</Button></div>
  <label className="pz-field">Search sites<input type="search" placeholder="Site name, order number or missing detail" value={search} onChange={e=>setSearch(e.target.value)}/></label>
  {notice&&<p role="status">{notice}</p>}
  {!editing&&error&&<p className="form-error" role="alert">{error}</p>}
  <div className="pz-table-scroll"><table className="master-table"><thead><tr><th>Sr. No.</th><th>Site name</th><th>Order number</th><th>What's missing</th><th>Status</th><th>Next action</th></tr></thead><tbody>{rows.map((row:any)=><Fragment key={row.id}>
   <tr><td>{row.sr}</td><td>{row.siteName||'Name required'}</td><td>{row.orderNumber}</td><td>{row.missing.length?row.missing.join('; '):'Details complete'}</td><td>{row.status}</td><td><Button variant="secondary" disabled={saving} onClick={()=>edit(row)}>{row.resolved?'Edit details':'Enter details'}</Button></td></tr>
   {editing?.id===row.id&&<tr><td colSpan={6}><form className="pz-stack" onSubmit={save} aria-label={`Edit details ${row.orderNumber}`}><h4>{row.orderNumber} · Site details</h4><div className="pz-form-grid">
    {text('siteName','Site name')}{select('delayOwner','Delay responsibility',['Unclassified',customer,'PZ'])}
    {select('deliveryStatus','Delivery status',['Delivered','Not delivered','Unverified'])}{text('deliveryDate','Delivery date','date')}
    {values.deliveryStatus==='Not delivered'&&text('ipoSharedDate','IPO shared date','date')}
    {select('installationStatus','Installation status',['Completed','Pending','Unverified','Review needed'])}{values.installationStatus==='Completed'&&text('installationDate','Installation completion date','date')}
    {text('invoiceReference','System invoice reference')}{text('invoiceAmount','Remaining system invoice amount (incl. GST)','number')}
    {select('invoiceStatus','Invoice submission',['Submitted','Not submitted','Unverified'])}{values.invoiceStatus==='Submitted'&&text('invoiceSubmittedDate','Invoice submission date','date')}
    {select('paymentStatus','Remaining system payment',['Received','Pending','Unverified'])}{values.paymentStatus==='Received'&&text('paymentReceivedAmount','Remaining payment received (incl. GST)','number')}{values.paymentStatus==='Received'&&text('paymentReceivedDate','Payment received date','date')}
   </div><label className="pz-field">Correction note<textarea required maxLength={1000} value={notes} onChange={e=>setNotes(e.target.value)}/></label><p className="pz-caption">Enter the remaining system invoice only. Advance and extra-cable payments stay separate. Blank details remain flagged.</p>
   <div className="pz-action-row"><Button type="submit" variant="primary" loading={saving} loadingLabel="Saving details…">Save</Button><Button variant="neutral" disabled={saving} onClick={()=>{setEditing(undefined);setError('');}}>Cancel</Button></div>{error&&<p className="form-error" role="alert">{error}</p>}
   </form></td></tr>}
  </Fragment>)}{!rows.length&&<tr><td colSpan={6}>No sites match your search.</td></tr>}</tbody></table></div>
 </section>;
}
