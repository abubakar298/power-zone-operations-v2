import {Decimal} from 'decimal.js';
import {HttpError} from '../http/errors.js';
const D=(v:Decimal.Value)=>new Decimal(v),m=(v:Decimal)=>v.toDecimalPlaces(2,Decimal.ROUND_HALF_UP).toFixed(2);
export const DISCOUNT_POLICY='approved-uplift-special-bess-epc-v1' as const;
export interface DiscountItem {key:string;group:string;category:string;cost:string;beforeTax:string;taxRate:string;approvedAllowance:string}
export interface DiscountStrategy {version:typeof DISCOUNT_POLICY;items:DiscountItem[]}
/** Integer-cent largest-remainder allocation, stable in saved item order. */
export function distributeCents(total:Decimal,weights:Decimal[]){
 if(!total.isInteger()||total.isNegative()||weights.some(w=>!w.isFinite()||w.isNegative()))throw new HttpError(422,'Invalid discount allocation basis.');
 const sum=weights.reduce((s,w)=>s.add(w),D(0));
 if(sum.isZero()){if(!total.isZero())throw new HttpError(422,'No eligible BESS/EPC selling amount for the Management Special Discount.');return weights.map(()=>D(0));}
 const exact=weights.map(w=>total.mul(w).div(sum)),result=exact.map(v=>v.floor());
 const remaining=total.sub(result.reduce((s,w)=>s.add(w),D(0))).toNumber();
 const order=exact.map((v,i)=>({i,f:v.sub(result[i])})).sort((a,b)=>b.f.comparedTo(a.f)||a.i-b.i);
 for(let i=0;i<remaining;i++)result[order[i].i]=result[order[i].i].add(1);
 return result;
}
export function allocateApprovedDiscount(strategy:DiscountStrategy,requested:string,roundedTotal?:string){
 if(strategy.version!==DISCOUNT_POLICY||!strategy.items.length||new Set(strategy.items.map(i=>i.key)).size!==strategy.items.length)throw new HttpError(422,'Invalid saved discount strategy.');
 const items=strategy.items;
 if(items.some(i=>!['0','10','18'].includes(i.taxRate)||!D(i.beforeTax).isFinite()||D(i.beforeTax).isNegative()||!D(i.approvedAllowance).isFinite()||D(i.approvedAllowance).isNegative()||D(i.approvedAllowance).gt(i.beforeTax)))throw new HttpError(422,'Invalid saved item selling or approved allowance.');
 const base=distributeCents(D(m(items.reduce((s,i)=>s.add(i.beforeTax),D(0)))).mul(100),items.map(i=>D(i.beforeTax)));
 const allowance=items.map(i=>D(i.approvedAllowance).mul(100));
 const maximumApproved=D(m(items.reduce((s,i)=>s.add(i.approvedAllowance),D(0)))).mul(100),discount=D(requested).mul(100);
 if(!discount.isFinite()||!discount.isInteger()||discount.isNegative())throw new HttpError(422,'Enter a nonnegative discount with at most two decimals.');
 const approved=Decimal.min(discount,maximumApproved),special=discount.sub(approved);
 const approvedShares=distributeCents(approved,allowance),standard=base.map((v,i)=>v.sub(approvedShares[i]));
 const eligible=items.map((item,i)=>['bess','other'].includes(item.category)&&!['solar','structure','earthing'].includes(item.group)?standard[i]:D(0));
 if(special.gt(eligible.reduce((s,w)=>s.add(w),D(0))))throw new HttpError(422,'Management Special Discount exceeds eligible BESS/EPC selling. Solar, structure and earthing remain protected.');
 const specialShares=distributeCents(special,eligible),after=standard.map((v,i)=>v.sub(specialShares[i]));
 const tax=items.map(()=>D(0)),originalTax=items.map(()=>D(0));
 const buckets:Record<string,string>={};
 for(const rate of ['0','10','18']){
  const weights=after.map((v,i)=>items[i].taxRate===rate?v:D(0)),originalWeights=base.map((v,i)=>items[i].taxRate===rate?v:D(0));
  const cents=weights.reduce((s,v)=>s.add(v),D(0)).mul(rate).div(100).toDecimalPlaces(0,Decimal.ROUND_HALF_UP);
  buckets[rate]=m(cents.div(100));
  distributeCents(cents,weights).forEach((v,i)=>tax[i]=tax[i].add(v));
  distributeCents(originalWeights.reduce((s,v)=>s.add(v),D(0)).mul(rate).div(100).toDecimalPlaces(0,Decimal.ROUND_HALF_UP),originalWeights).forEach((v,i)=>originalTax[i]=originalTax[i].add(v));
 }
 const unrounded=after.reduce((s,v,i)=>s.add(v).add(tax[i]),D(0));
 const rounding=roundedTotal===undefined?D(0):D(roundedTotal).mul(100).sub(unrounded);
 if(!rounding.isInteger()||rounding.abs().gt(2))throw new HttpError(422,'Rounded payable does not reconcile with the item discount and GST.');
 const index=after.findLastIndex(v=>v.gt(0));if(index<0&&!rounding.isZero())throw new HttpError(422,'No eligible row for payable rounding.');
 if(index>=0)after[index]=after[index].add(rounding);
 if(after.some(v=>v.isNegative()))throw new HttpError(422,'Discount would make an item selling amount negative.');
 const lines=items.map((item,i)=>({...item,originalBeforeTax:m(base[i].div(100)),originalTax:m(originalTax[i].div(100)),originalTotal:m(base[i].add(originalTax[i]).div(100)),approvedDiscount:m(approvedShares[i].div(100)),managementSpecialDiscount:m(specialShares[i].div(100)),allocatedDiscount:m(approvedShares[i].add(specialShares[i]).div(100)),beforeTaxReduction:m(approvedShares[i].add(specialShares[i]).div(100)),taxReduction:m(originalTax[i].sub(tax[i]).div(100)),beforeTax:m(after[i].div(100)),tax:m(tax[i].div(100)),total:m(after[i].add(tax[i]).div(100)),taxRoundingAdjustment:'0.00'}));
 return {policy:DISCOUNT_POLICY,lines,approvedDiscount:m(approved.div(100)),managementSpecialDiscount:m(special.div(100)),discount:m(discount.div(100)),originalSubtotal:m(base.reduce((s,v)=>s.add(v),D(0)).div(100)),originalTax10:m(originalTax.filter((_,i)=>items[i].taxRate==='10').reduce((s,v)=>s.add(v),D(0)).div(100)),originalTax18:m(originalTax.filter((_,i)=>items[i].taxRate==='18').reduce((s,v)=>s.add(v),D(0)).div(100)),originalDiscount:m(discount.div(100)),subtotal:m(after.reduce((s,v)=>s.add(v),D(0)).div(100)),tax:m(tax.reduce((s,v)=>s.add(v),D(0)).div(100)),solarTax:buckets['10'],otherTax:buckets['18'],total:m(unrounded.add(rounding).div(100)),roundingAdjustment:m(rounding.div(100))};
}
export function discountForRoundedPayable(strategy:DiscountStrategy,target:string){
 const before=allocateApprovedDiscount(strategy,'0');if(D(target).gt(before.total))throw new HttpError(400,'Rounded total cannot exceed the original selling price including tax.');
 const allowance=strategy.items.reduce((s,i)=>s.add(i.approvedAllowance),D(0));
 const eligible=strategy.items.filter(i=>['bess','other'].includes(i.category)&&!['solar','structure','earthing'].includes(i.group)).reduce((s,i)=>s.add(D(i.beforeTax).sub(i.approvedAllowance)),D(0));
 let low=0,high=D(m(allowance.add(eligible))).mul(100).toNumber();
 while(low<high){const mid=Math.floor((low+high)/2),result=allocateApprovedDiscount(strategy,D(mid).div(100).toFixed(2));if(D(result.total).gt(target))low=mid+1;else high=mid;}
 const candidates=[low,Math.max(0,low-1)].map(c=>({discount:D(c).div(100).toFixed(2),amount:allocateApprovedDiscount(strategy,D(c).div(100).toFixed(2)).total})).sort((a,b)=>D(a.amount).sub(target).abs().comparedTo(D(b.amount).sub(target).abs()));
 if(D(candidates[0].amount).sub(target).abs().gt('.02'))throw new HttpError(422,'Rounded payable exceeds the allowed BESS/EPC discount capacity.');
 return candidates[0].discount;
}
