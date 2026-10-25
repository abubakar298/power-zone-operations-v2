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
