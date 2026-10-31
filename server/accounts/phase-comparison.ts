import {Decimal} from 'decimal.js';

export const closurePhases=['Solar Panels','Structure','Inverter','Batteries','BMS','EPC'];
const value=(v:unknown):Decimal|null=>{
 if(typeof v!=='string'&&typeof v!=='number')return null;
 if(String(v).trim()==='')return null;
 try{const n=new Decimal(v);return n.isFinite()&&n.gte(0)?n:null;}catch{return null;}
};
/** Arithmetic mean of recorded phase costs; missing values are never zero. */
export function phaseCostComparison(snapshots:any[]){
 const average=(values:unknown[])=>{const costs=values.map(value).filter((v):v is Decimal=>v!==null);return {jobs:costs.length,averageActualCost:costs.length?costs.reduce((s,n)=>s.add(n),new Decimal(0)).div(costs.length).toFixed(2):null};};
 const eligible=snapshots.filter(s=>value(s?.summary?.actual)!==null);
 return {closedJobs:eligible.length,phases:Object.fromEntries(closurePhases.map(p=>[p,average(eligible.map(s=>p==='EPC'?s.actualEpc??s.input?.epcAggregate:s.input?.actual?.[p]))])),total:average(eligible.map(s=>s.summary.actual))};
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
