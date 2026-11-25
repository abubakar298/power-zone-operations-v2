import {useState} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {Field} from '../ui/Field.js';
import {AccountsRecordDialog} from './AccountsRecordDialog.js';

/** Close a revision that was resolved outside the portal (user request, 25 Nov 2026). It leaves the Revisions tab and
 * its quotation returns to its normal step; the request and the reason stay in history. */
export function CloseRevisionDialog({task,session,onClose,onClosed}:{task:any;session:Session;onClose:()=>void;onClosed:(message:string)=>Promise<void>|void}){
 const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[requestKey]=useState(()=>crypto.randomUUID());
 async function save(e:React.FormEvent){
  e.preventDefault();if(busy)return;
  if(reason.trim().length<5){setError('Enter why this revision is no longer needed (at least 5 characters).');return;}
  if(!window.confirm(`Close the revision for ${task.number??'this quotation'}?\nIt will leave the Revisions tab and the quotation returns to its normal step. The record and your reason stay in history.`))return;
  setBusy(true);setError('');
  try{await api(`/coordinator/revision-requests/${task.revisionRequestId??task.id}/close`,{csrf:session.csrfToken,body:{reason:reason.trim(),requestKey}});await onClosed(`Revision for ${task.number??'the quotation'} closed.`);}
  catch(err){setError((err as Error).message);}finally{setBusy(false);}
 }
 return <AccountsRecordDialog title="Close Revision" reference={task.number??''} subtitle={`${task.customer||'Customer not recorded'} · ${task.site??''}`} onClose={()=>{if(!busy)onClose();}}>
  <form className="pz-stack" onSubmit={save}>
   <p>Use this only when the revision was resolved outside the portal or is no longer needed. Nothing is deleted.</p>
   <Field id="close-revision-reason" label="Reason"><textarea id="close-revision-reason" required minLength={5} maxLength={2000} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></Field>
   {error&&<p role="alert" className="form-error">{error}</p>}
   <div className="pz-action-row"><Button type="submit" variant="danger" loading={busy}>Close revision</Button><Button type="button" variant="neutral" disabled={busy} onClick={onClose}>Cancel</Button></div>
  </form>
 </AccountsRecordDialog>;
}
