import { useEffect, useState } from "react";
import { Decimal } from "decimal.js";
import { api } from "../api.js";
import { money } from "../numbers.js";
import { price, type PricingSnapshot } from "../../server/commercial/engine.js";
import type { BoqSnapshot } from "../../server/boq/engine.js";
import type { CommercialPolicy } from "../../server/commercial/active-policy.js";
export function StandardSellingSummary({snapshot}:{snapshot:BoqSnapshot}){
 const [policy,setPolicy]=useState<CommercialPolicy>(),[error,setError]=useState("");
 useEffect(()=>{let active=true;api<CommercialPolicy>("/commercial/standard-policy").then(p=>{if(active)setPolicy(p);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 let selling:PricingSnapshot|undefined,classificationError="";
 try{if(policy)selling=price(snapshot,"Preview",{boqRevisionId:"",cashGstTreatment:undefined,presentation:"No Breakup",taxMode:"Show Sales Tax Separately",markups:{...policy.markups,balance:policy.markups.other,rest:policy.markups.other},preparedBy:"Preview",remarks:""},policy);}catch(e){classificationError=(e as Error).message;}
 if(!selling)return <p role="status">{classificationError||error||"Loading standard selling prices…"}</p>;
 const allowance=selling.standardDiscountStrategy!.groups.reduce((sum,g)=>sum.add(g.beforeTax),new Decimal(0));
 return <section className="detail-panel"><h3>Standard commercial summary</h3><p>Policy version {policy!.version}. Management-approved discount preserves the policy selling price. Management reviews the quotation.</p><div className="table-scroll"><table><thead><tr><th>Category</th><th>Cost</th><th>Net standard markup</th><th>Net selling before GST</th></tr></thead><tbody>{selling.rows.map(r=><tr key={r.key}><th>{r.name}</th><td>{money(r.cost)}</td><td>{r.markup}%</td><td>{money(r.beforeTax)}</td></tr>)}</tbody></table></div><p>Offer before discounts, excluding GST: <strong>PKR {money(new Decimal(selling.subtotal).add(allowance).toFixed(2))}</strong></p><p>Management-approved discount, excluding GST: <strong>PKR {money(allowance.toFixed(2))}</strong></p><p>Net selling before GST: <strong>PKR {money(selling.subtotal)}</strong> · GST: <strong>PKR {money(selling.tax)}</strong> · Standard payable: <strong>PKR {money(selling.total)}</strong></p></section>;
}
