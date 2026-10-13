import {useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {discountedSellingReview} from '../../server/commercial/engine.js';
import {money} from '../numbers.js';
import {Button} from '../ui/Button.js';
export function RevisionPricingSummary({session,source}:{session:Session;source:any}){
 const [pricing,setPricing]=useState<any>(),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;setPricing(undefined);setError('');if(source?.pricing_id)void api<any>(`/commercial/pricing/${source.pricing_id}`).then(value=>{if(active)setPricing(value.snapshot);}).catch(e=>{if(active)setError(e.message);});else if(source?.sourceType==='pre-agreed')void api<any>(`/boqs/${source.boq_revision_id}`).then(value=>{if(active)setPricing({frameworkOrder:value.snapshot.frameworkRevisionBasis.order});}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[source?.id,source?.pricing_id,attempt]);
 const order=pricing?.frameworkOrder;
 const review=pricing&&!order?discountedSellingReview(pricing):null;
 const rows=source?.pricingSummary?.rows??order?.allocation.lines.map((line:any)=>({name:line.description,beforeDiscount:line.originalBeforeTax??line.beforeTax,discount:line.beforeTaxReduction??'0',afterDiscount:line.beforeTax,tax:line.tax,total:line.total}))??review?.rows.map((r:any)=>({name:r.name,beforeDiscount:r.beforeTax,discount:r.discountAmount,afterDiscount:r.sellingAfterDiscount,tax:r.discountedTax,total:r.discountedAfterTax}));
 const savedFooter=source?.snapshot?.footer??source?.pricingSummary?.footer??(order?[{label:'Subtotal before GST',amount:order.allocation.subtotal},{label:'GST',amount:order.allocation.tax},{label:'Grand total including GST',amount:order.allocation.total}]:undefined);
 return <details className="pz-form-section pz-technical-summary"><summary><span className="pz-technical-summary-heading"><h3>Pricing Summary</h3><span>{source?.sourceType==='pre-agreed'?'Saved pre-agreed prices':'Saved quotation prices'}{source?.number?` · ${source.number}`:''}</span></span></summary>
  <div className="pz-stack pz-technical-summary-content">
   {error&&<><p className="form-error" role="alert">{error}</p><div><Button variant="secondary" onClick={()=>setAttempt(value=>value+1)}>Retry Pricing Summary</Button></div></>}
   {!rows&&!error&&<p role="status">Loading saved pricing…</p>}
   {rows&&<p className="pz-caption">All amounts in PKR.</p>}
   {rows&&<div className="pz-table-scroll"><table className="pz-table"><thead><tr><th>Category</th><th className="numeric">Selling price</th><th className="numeric">Discount</th><th className="numeric">After discount</th><th className="numeric">Sales tax</th><th className="numeric">Including tax</th></tr></thead><tbody>{rows.map((r:any,index:number)=><tr key={index}><th>{r.name}</th><td className="numeric">{money(r.beforeDiscount)}</td><td className="numeric">{money(r.discount)}</td><td className="numeric">{money(r.afterDiscount)}</td><td className="numeric">{money(r.tax)}</td><td className="numeric">{money(r.total)}</td></tr>)}</tbody></table></div>}
   {savedFooter&&<div className="pz-revision-pricing-totals">{savedFooter.map((r:any,index:number)=><p key={index}><span>{r.label}</span><strong>PKR {money(r.amount)}</strong></p>)}</div>}
  </div></details>;
}
