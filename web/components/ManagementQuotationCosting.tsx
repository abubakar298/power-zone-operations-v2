import {useEffect,useState} from 'react';
import {Decimal} from 'decimal.js';
import {api,type Session} from '../api.js';
import {money,decimalDisplay} from '../numbers.js';
import {BoqCosting} from '../pages/BoqCosting.js';

/** Display frozen costing/pricing and the saved discount allocation; never use current Rate Master. */
export function ManagementQuotationCosting({quotation,session}:{quotation:any;session:Session}){
 const [data,setData]=useState<any>(),[error,setError]=useState('');
 useEffect(()=>{let active=true;setData(undefined);setError('');void Promise.all([api<any>(`/boqs/${quotation.boq_revision_id}`),api<any>(`/commercial/pricing/${quotation.pricing_id}`),api<any>(`/commercial/quotations/${quotation.id}/discount-review`,{csrf:session.csrfToken,body:{discount:'0'}})]).then(([costing,pricing,review])=>{if(active)setData({costing,pricing:pricing.snapshot,review});}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[quotation.id,session.csrfToken]);
 if(!data)return <section className="pz-panel"><h2>Costing &amp; Markup</h2>{error?<p className="form-error" role="alert">{error}</p>:<p role="status">Loading saved costing and markup…</p>}</section>;
 const {costing,pricing,review}=data,allocation=quotation.snapshot.discountAllocation;
 const cost=new Decimal(review.cost),selling=new Decimal(allocation?.subtotal??review.original.revenue),profit=selling.sub(cost),markup=cost.gt(0)?profit.div(cost).mul(100):null;
 const itemRows=pricing.itemPricing?.length?pricing.itemPricing:pricing.rows;
 const rows=itemRows.map((r:any)=>{
  const line=allocation?.lines.find((l:any)=>l.key===r.key);
  const source=costing.snapshot.lines.find((l:any)=>l.key===r.key);
  const net=line?.beforeTax??r.beforeTax,p=new Decimal(net).sub(r.cost);
  return{...r,name:r.description??source?.description??r.name,net,approved:line?.approvedDiscount,special:line?.managementSpecialDiscount,profit:p.toFixed(2),effectiveMarkup:new Decimal(r.cost).gt(0)?p.div(r.cost).mul(100).toFixed(2):null};
 });
 return <section className="pz-panel pz-stack" aria-label="Management quotation costing">
  <h2>Costing &amp; Markup</h2><p className="pz-caption">Saved costing and selling prices for this quotation. Markup is profit divided by cost. Current database rates are not applied.</p>
  <div className="pz-table-scroll"><table className="master-table"><thead><tr><th>Item</th><th className="numeric">Cost (PKR)</th><th className="numeric">Selling before discount</th>{allocation&&<><th className="numeric">Approved Discount</th><th className="numeric">Management Special Discount</th></>}<th className="numeric">{allocation?'Selling after discount':'Saved selling before tax'}</th><th className="numeric">Profit (PKR)</th><th className="numeric">Markup %</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.key}><th>{r.name}</th><td className="numeric">{money(r.cost)}</td><td className="numeric">{money(r.beforeTax)}</td>{allocation&&<><td className="numeric">{r.approved==null?'—':money(r.approved)}</td><td className="numeric">{r.special==null?'—':money(r.special)}</td></>}<td className="numeric">{money(r.net)}</td><td className="numeric">{money(r.profit)}</td><td className="numeric">{r.effectiveMarkup===null?'—':`${decimalDisplay(r.effectiveMarkup,2)}%`}</td></tr>)}</tbody></table></div>
  {!allocation&&<p className="pz-caption">The item table shows saved pricing before quotation-level discounts. Final totals below include the quotation's discount and tax treatment.</p>}
  <div className="quote-totals"><p><span>Total cost</span><strong>PKR {money(review.cost)}</strong></p><p><span>Final selling excluding GST</span><strong>PKR {money(selling.toFixed(2))}</strong></p><p><span>Profit</span><strong>PKR {money(profit.toFixed(2))}</strong></p><p><span>Markup on cost</span><strong>{markup===null?'—':`${decimalDisplay(markup.toFixed(2),2)}%`}</strong></p><p><span>GST</span><strong>PKR {money(allocation?.tax??review.original.tax)}</strong></p><p><span>Final payable</span><strong>PKR {money(allocation?.total??review.original.payable)}</strong></p></div>
  <details><summary>Open detailed BOQ costing</summary><BoqCosting snapshot={costing.snapshot} number={costing.number} createdAt={costing.created_at} pdfUrl={`/api/boqs/${costing.id}/costing.pdf`}/></details>
 </section>;
}
