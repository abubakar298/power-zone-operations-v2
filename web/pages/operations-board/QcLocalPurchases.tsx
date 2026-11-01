import {useEffect,useState} from 'react';
import {api,type Session} from '../../api.js';
import {Button} from '../../ui/Button.js';
import {Editor,useSave} from './forms.js';
import {confirmLeaveWorkspace} from '../../hooks/useUnsavedChanges.js';
type Item={key:string;itemId:string;description:string;quantity:string};
type Record={version:number;items:Item[]};
export function QcLocalPurchases({boardId,session}:{boardId:string;session:Session}){
 const [record,setRecord]=useState<Record>(),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function load(){try{setRecord(await api<Record>('/operations-board/sites/'+encodeURIComponent(boardId)+'/local-purchases'));setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{setRecord(undefined);void load();},[boardId]);
 return <section className="pz-stack"><h3>Local Purchase Items — Accounts</h3><p className="pz-caption">Record site purchases for Accounts to enter in PT/costs. These do not belong to warehouse stock, Parent DO reconciliation or return IGPs.</p>{notice&&<p role="status" className="ob-success">{notice}</p>}{error&&<p role="alert" className="form-error">{error}</p>}{!record?<Button variant="neutral" onClick={()=>void load()}>{error?'Retry local purchases':'Loading local purchases…'}</Button>:<PurchaseForm key={boardId+':'+record.version} boardId={boardId} session={session} record={record} onSaved={()=>{setNotice('Local purchases saved for Accounts. No stock or PT amounts were posted.');void load();}}/>}</section>;
}
function PurchaseForm({boardId,session,record,onSaved}:{boardId:string;session:Session;record:Record;onSaved:()=>void}){
 const [items,setItems]=useState<Item[]>(record.items),post=useSave(session),dirty=JSON.stringify(items)!==JSON.stringify(record.items);
 return <Editor dirty={dirty} busy={post.busy} error={post.error} label="Save Local Purchases for Accounts" onCancel={()=>{if(confirmLeaveWorkspace())setItems(record.items);}} onSubmit={()=>void post.save('/operations-board/sites/'+encodeURIComponent(boardId)+'/local-purchases',{version:record.version,items},onSaved)}>
  <div className="ob-actions"><Button variant="secondary" disabled={items.length>=200} onClick={()=>setItems(old=>[...old,{key:crypto.randomUUID(),itemId:'',description:'',quantity:''}])}>Add local purchase item</Button></div>
  {!items.length?<p>No local purchase items recorded.</p>:<div className="pz-table-scroll"><table className="ops-table qc-purchase-table"><thead><tr><th>SR#</th><th>Item ID</th><th>Description</th><th>Quantity</th><th>Action</th></tr></thead><tbody>{items.map((p,n)=><tr key={p.key}><td><span className="qc-usage-primary">{n+1}</span></td><td><input required maxLength={160} aria-label={'Local purchase item ID '+(n+1)} value={p.itemId} onChange={e=>setItems(old=>old.map(v=>v.key===p.key?{...v,itemId:e.target.value}:v))}/></td><td><input required maxLength={1000} aria-label={'Local purchase description '+(n+1)} value={p.description} onChange={e=>setItems(old=>old.map(v=>v.key===p.key?{...v,description:e.target.value}:v))}/></td><td><input required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,6})?" aria-label={'Local purchase quantity '+(n+1)} value={p.quantity} onChange={e=>setItems(old=>old.map(v=>v.key===p.key?{...v,quantity:e.target.value}:v))}/></td><td><Button variant="neutral" aria-label={'Remove local purchase item '+(n+1)} onClick={()=>setItems(old=>old.filter(v=>v.key!==p.key))}>Remove</Button></td></tr>)}</tbody></table></div>}
 </Editor>;
}
