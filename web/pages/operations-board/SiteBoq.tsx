import {useEffect,useState} from 'react';
import {api} from '../../api.js';
import {Button} from '../../ui/Button.js';
import {Section} from './forms.js';
import {day} from './types.js';

type Item={description:string;brand:string|null;specification:string|null;qty:string|null;unit:string|null};
type Details={linked:false}|{linked:true;issuanceNumber:string;issuedAt:string;ipoNumber:string;boqNumber:string|null;siteName:string;siteCode:string|null;items:Item[]};

/** View-only BOQ details: the item list issued to Operations. No prices, nothing editable. */
export function SiteBoq({siteId,onClose}:{siteId:string;onClose:()=>void}){
 const [data,setData]=useState<Details>(),[error,setError]=useState('');
 useEffect(()=>{let active=true;api<Details>(`/operations-board/sites/${encodeURIComponent(siteId)}/boq`).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[siteId]);
 return <Section title="BOQ details" action={<Button variant="neutral" onClick={onClose}>Close</Button>}>
  {error?<p role="alert" className="form-error">{error}</p>:!data?<p role="status">Opening BOQ details…</p>:!data.linked?<p>No BOQ is linked to this site in the portal.</p>:<>
   <p>{data.boqNumber?`BOQ ${data.boqNumber} · `:''}IPO {data.ipoNumber} · Issued to Operations {day(data.issuedAt)}{data.siteCode?` · Site code ${data.siteCode}`:''}</p>
   <p className="pz-caption">View only. Items and quantities as issued to Operations.</p>
   <div className="pz-table-scroll"><table className="ops-table"><thead><tr><th>SR#</th><th>Item</th><th>Brand</th><th>Specification</th><th>Qty</th><th>Unit</th></tr></thead><tbody>
    {data.items.map((i,n)=><tr key={n}><td>{n+1}</td><td>{i.description}</td><td>{i.brand||'—'}</td><td>{i.specification||'—'}</td><td>{i.qty??'—'}</td><td>{i.unit||'—'}</td></tr>)}
   </tbody></table></div>
   {!data.items.length&&<p>No items were issued with this BOQ.</p>}
  </>}
 </Section>;
}
