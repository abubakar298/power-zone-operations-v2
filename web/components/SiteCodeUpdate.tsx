import { useState } from "react";
import { api, type Session } from "../api.js";
import { Button } from "../ui/Button.js";
import { Field } from "../ui/Field.js";

export function SiteCodeUpdate({site,session,onSaved,onCancel}: {site:any;session:Session;onSaved:()=>Promise<void>;onCancel:()=>void}) {
  const [code,setCode]=useState(String(site.code)),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function save(e:React.FormEvent){
    e.preventDefault();const next=code.trim();
    if(!next||next===site.code||!reason.trim()){setError("Enter a different branch code and the reason for the change.");return;}
    if(!window.confirm(`Update ${site.name}: branch code ${site.code} → ${next}?\n${reason.trim()}\nEarlier survey, heads-up and document snapshots retain their recorded codes.`))return;
    if(!window.confirm("Confirm this change to the site database? New documents will use the updated branch code. This does not confirm a sale."))return;
    setBusy(true);setError("");
    try {await api("/masters/sites",{csrf:session.csrfToken,body:{id:String(site.id),version:Number(site.version),values:{name:site.name,code:next,location:site.location??"",status:site.status},changeReason:reason.trim()}});await onSaved();window.dispatchEvent(new CustomEvent("pz:workflow-completed",{detail:{message:`Branch code updated to ${next}.`}}));}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <form className="pz-panel pz-stack" onSubmit={save}><h3>Update Branch Code</h3><p>{site.name} · Current code: {site.code}</p><div className="pz-form-grid"><Field id="updated-branch-code" label="New branch code" hint="Leading zeros are preserved."><input id="updated-branch-code" value={code} maxLength={30} disabled={busy} onChange={e=>setCode(e.target.value)}/></Field><Field id="branch-code-reason" label="Reason for change"><textarea id="branch-code-reason" value={reason} maxLength={2000} disabled={busy} onChange={e=>setReason(e.target.value)}/></Field></div><p className="pz-caption">Updates the current site record. Earlier survey, heads-up and approved document snapshots are preserved. The old code, new code, reason and person making the change are recorded.</p><div className="pz-action-row"><Button type="submit" variant="primary" loading={busy}>Save Branch Code</Button><Button variant="neutral" disabled={busy} onClick={onCancel}>Cancel</Button></div>{error&&<p role="alert" className="form-error">{error}</p>}</form>;
}
