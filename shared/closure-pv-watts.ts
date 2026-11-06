import {Decimal} from 'decimal.js';
const positive=(v:unknown)=>{
 if((typeof v!=='string'&&typeof v!=='number')||String(v).trim()==='')return null;
 try{const n=new Decimal(v);return n.isFinite()&&n.gt(0)?n:null;}catch{return null;}
};
/** Use only the saved approved capacity or the IPO-linked immutable BOQ survey.
 * Actual installation/reconciliation quantities are never a fallback. */
export function agreedBoqPvWatts(source:{agreedWatts?:unknown;survey?:{panelQty?:unknown;panelWattage?:unknown}}):{watts:string;basis:string}|null{
 const agreed=positive(source.agreedWatts);
 if(agreed)return {watts:agreed.toString(),basis:'Pre-agreed BOQ capacity'};
 const count=positive(source.survey?.panelQty),rating=positive(source.survey?.panelWattage);
 return count&&count.isInteger()&&rating?{watts:count.mul(rating).toString(),basis:`Pre-agreed BOQ: ${count.toString()} panels × ${rating.toString()} W`}:null;
}
export function closurePvWatts(job:any):{watts:string;basis:string}|null{
 const watts=positive(job?.agreedPv?.watts);
 return watts?{watts:watts.toString(),basis:job.agreedPv.basis||'Pre-agreed BOQ capacity'}:null;
}
