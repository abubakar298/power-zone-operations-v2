import {useState} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {Field} from '../ui/Field.js';
import {AccountsRecordDialog} from './AccountsRecordDialog.js';

/** "Not needed" for an approved BOQ that will never be priced, e.g. a Quick BOQ replaced by a full survey of the same
 * site (user decision, 27 Nov 2026). It leaves Design Review; the BOQ and the reason stay in history. */
export function RetireBoqDialog({task,session,onClose,onRetired}:{task:any;session:Session;onClose:()=>void;onRetired:(message:string)=>Promise<void>|void}){
 const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[requestKey]=useState(()=>crypto.randomUUID());
 const number=task.number??task.reference??'this BOQ';
 async function save(e:React.FormEvent){
  e.preventDefault();if(busy)return;
  if(reason.trim().length<5){setError('Enter why this BOQ is not needed (at least 5 characters).');return;}
  if(!window.confirm(`Mark ${number} as not needed?\nIt will leave Design Review and will not be priced. The BOQ and your reason stay in history.`))return;
  setBusy(true);setError('');
  try{await api(`/coordinator/boq-revisions/${task.boq_revision_id??task.id}/retire`,{csrf:session.csrfToken,body:{reason:reason.trim(),requestKey}});await onRetired(`${number} marked as not needed.`);}
  catch(err){setError((err as Error).message);}finally{setBusy(false);}
 }
 return <AccountsRecordDialog title="BOQ Not Needed" reference={number} subtitle={`${task.customer||'Customer not recorded'} · ${task.site??''}`} onClose={()=>{if(!busy)onClose();}}>
  <form className="pz-stack" onSubmit={save}>
   <p>Use this only for a BOQ that will never be priced, for example a duplicate replaced by a full survey of the same site. Nothing is deleted.</p>
   <Field id="retire-boq-reason" label="Reason"><textarea id="retire-boq-reason" required minLength={5} maxLength={2000} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></Field>
   {error&&<p role="alert" className="form-error">{error}</p>}
   <div className="pz-action-row"><Button type="submit" variant="danger" loading={busy}>Mark as not needed</Button><Button type="button" variant="neutral" disabled={busy} onClick={onClose}>Cancel</Button></div>
  </form>
 </AccountsRecordDialog>;
}
