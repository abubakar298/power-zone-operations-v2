import {useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {useSave} from '../pages/operations-board/forms.js';
import {useUnsavedChanges} from '../hooks/useUnsavedChanges.js';

type Review={siteId:string;siteName:string;customer:string;ipo:string;reference:string;review:string;reviewHash:string};

/** Old DO review notes hold QC verification until the Inventory head confirms them. Shown only to the head. */
export function HistoricalDoReviews({session}:{session:Session}){
 const [data,setData]=useState<{canConfirm:boolean;reviews:Review[]}>(),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;void api<{canConfirm:boolean;reviews:Review[]}>('/material-dispatches/historical-reviews').then(v=>{if(active){setData(v);setError('');}}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[revision,session.user.id]);
 if(error)return <p role="alert" className="form-error">{error}</p>;
 if(!data?.canConfirm||!data.reviews.length)return null;
 return <section className="pz-panel pz-stack historical-do-reviews">
  <div className="ob-section-title"><h2>Old DO notes to confirm</h2><span>{data.reviews.length} sites</span></div>
  <p>QC cannot verify material usage on these completed sites until you confirm the note on the old DO. Check where the listed items came from, then confirm with a short note.</p>
  <div className="pz-table-scroll"><table className="ob-table historical-do-review-table"><thead><tr><th>SR#</th><th>Site</th><th>DO</th><th>Note to confirm</th><th>Your confirmation</th></tr></thead>
   <tbody>{data.reviews.map((r,n)=><ReviewRow key={r.siteId+':'+r.reviewHash} index={n} review={r} session={session} onConfirmed={()=>setRevision(v=>v+1)}/>)}</tbody></table></div>
 </section>;
}

function ReviewRow({index,review:r,session,onConfirmed}:{index:number;review:Review;session:Session;onConfirmed:()=>void}){
 const post=useSave(session),[reason,setReason]=useState('');useUnsavedChanges(!!reason.trim()||post.busy);
 async function confirm(){if(reason.trim().length<3){post.setError('Enter a short note, for example where the items came from.');return;}await post.save('/material-dispatches/historical-reviews/'+encodeURIComponent(r.siteId)+'/confirm',{reviewHash:r.reviewHash,reason},()=>{setReason('');onConfirmed();});}
 return <tr>
  <td>{index+1}</td>
  <td><strong>{r.siteName||r.siteId}</strong><small>{[r.ipo,r.customer].filter(Boolean).join(' · ')}</small></td>
  <td><strong>{r.reference}</strong></td>
  <td><strong>{r.review}</strong></td>
  <td><label>Confirmation note<textarea aria-label={'Confirmation note for '+(r.siteName||r.siteId)} disabled={post.busy} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <div className="ob-actions"><Button variant="success" loading={post.busy} disabled={post.busy} onClick={()=>void confirm()}>Confirm note</Button></div>
   {post.error&&<p role="alert" className="form-error">{post.error}</p>}</td>
 </tr>;
}
