import {Decimal} from 'decimal.js';

export const closurePhases=['Solar Panels','Structure','Inverter','Batteries','BMS','EPC'];
const value=(v:unknown):Decimal|null=>{
 if(typeof v!=='string'&&typeof v!=='number')return null;
 if(String(v).trim()==='')return null;
 try{const n=new Decimal(v);return n.isFinite()&&n.gte(0)?n:null;}catch{return null;}
};
/** Mean markup amount per comparable closed job, with cost-weighted markup %. Missing data stays absent. */
export function phaseCostComparison(snapshots:any[]){
 const eligible=snapshots.filter(s=>value(s?.summary?.actual)!==null);
 const average=(pairs:{selling:unknown;cost:unknown;recordedMarkup?:unknown}[])=>{
  const costs=pairs.map(p=>value(p.cost)).filter((v):v is Decimal=>v!==null);
  const complete=pairs.map(p=>{const selling=value(p.selling),cost=value(p.cost);let markup:Decimal|null=selling!==null&&cost!==null?selling.sub(cost):null;if(markup===null&&p.recordedMarkup!==undefined&&p.recordedMarkup!==null&&String(p.recordedMarkup).trim()!==''){try{const n=new Decimal(p.recordedMarkup as string);if(n.isFinite())markup=n;}catch{}}return {cost,markup};}).filter((p):p is {cost:Decimal;markup:Decimal}=>p.cost!==null&&p.markup!==null);
  const totalCost=complete.reduce((s,p)=>s.add(p.cost),new Decimal(0)),totalMarkup=complete.reduce((s,p)=>s.add(p.markup),new Decimal(0));
  return {jobs:costs.length,averageActualCost:costs.length?costs.reduce((s,n)=>s.add(n),new Decimal(0)).div(costs.length).toFixed(2):null,markupJobs:complete.length,averageActualMarkup:complete.length?totalMarkup.div(complete.length).toFixed(2):null,averageActualMarkupPercent:complete.length&&totalCost.gt(0)?totalMarkup.div(totalCost).mul(100).toFixed(2):null};
 };
 const epcSelling=eligible.map(s=>closureEpcSelling(s.phaseSelling?.EPC,s.epcBudget,s.budget?.EPC,s.epcSelling));
 return {closedJobs:eligible.length,
  phases:Object.fromEntries(closurePhases.map(p=>[p,average(eligible.map(s=>({selling:s.phaseSelling?.[p],cost:p==='EPC'?s.actualEpc??s.input?.epcAggregate:s.input?.actual?.[p]})))])),
  epc:Object.fromEntries(closureEpcItems.map(p=>[p,average(eligible.map((s,i)=>({selling:epcSelling[i]?.[p],cost:s.input?.epcDetails===false?undefined:s.input?.epc?.[p]})))])),
  total:average(eligible.map(s=>({selling:s.selling??s.summary?.selling,cost:s.summary.actual,recordedMarkup:s.summary.actualMarkup})))
 };
}

export const closureEpcItems=['Electrical Labour','Earthing Cost','Deliveries','Installation Cost'];
/** Allocate approved EPC selling by frozen budget weights; cumulative rounding preserves the total. */
export function closureEpcSelling(selling:unknown,budget:Record<string,unknown>={},expectedBudget?:unknown,explicit?:Record<string,unknown>){
 const total=value(selling),weights=closureEpcItems.map(n=>value(budget[n]));
 if(!total)return null;
 if(explicit){const amounts=closureEpcItems.map(n=>value(explicit[n]));if(amounts.every((v):v is Decimal=>v!==null)&&amounts.reduce((s,v)=>s.add(v),new Decimal(0)).eq(total))return Object.fromEntries(closureEpcItems.map((n,i)=>[n,amounts[i]!.toFixed(2)]));}
 if(!weights.every((v):v is Decimal=>v!==null))return null;
 const sum=weights.reduce((s,v)=>s.add(v),new Decimal(0));
 if(sum.lte(0)||(expectedBudget!==undefined&&(!value(expectedBudget)||!sum.eq(value(expectedBudget)!))))return null;
 let cumulative=new Decimal(0),allocated=new Decimal(0);
 return Object.fromEntries(closureEpcItems.map((name,i)=>{cumulative=cumulative.add(weights[i]!);const target=total.mul(cumulative).div(sum).toDecimalPlaces(2,Decimal.ROUND_HALF_UP),amount=target.sub(allocated);allocated=target;return [name,amount.toFixed(2)];}));
}
