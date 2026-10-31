import {Decimal} from 'decimal.js';
const positive=(v:unknown)=>{
 if((typeof v!=='string'&&typeof v!=='number')||String(v).trim()==='')return null;
 try{const n=new Decimal(v);return n.isFinite()&&n.gt(0)?n:null;}catch{return null;}
};
/** Match the saved inventory reconciliation: panel quantity × watts per panel,
 * otherwise explicit installed PV watts. Never infer watts from a configuration ID. */
export function closurePvWatts(entry:any):{watts:string;basis:string}|null{
 const count=positive(entry?.panelCount),rating=positive(entry?.panelWattage);
 if(count&&count.isInteger()&&rating)return {watts:count.mul(rating).toString(),basis:`${count.toString()} panels × ${rating.toString()} W`};
 const installed=positive(entry?.installedWatts);
 return installed?{watts:installed.toString(),basis:'Recorded installed PV wattage'}:null;
}
