import{Decimal}from'decimal.js';
import{cashDeal}from'../commercial/deal.js';
import{DISCOUNT_POLICY}from'../commercial/discount-strategy.js';
import{peachtreeDivision as legacyDivision}from'./peachtree.js';
import{HttpError}from'../http/errors.js';
/** New saved allocation contract only; archived PT calculation remains byte-identical. */
export function peachtreeDivision(...args:Parameters<typeof legacyDivision>){
 const [allocation,boq,pricing]=args;
 if(allocation.policy!==DISCOUNT_POLICY)return legacyDivision(...args);
 const included=cashDeal(pricing.input)||!pricing.input.saleType&&pricing.input.taxMode==='Tax Included',field=included?'total':'beforeTax',target=included?allocation.total:allocation.subtotal;
 const phaseNames=boq.survey.family==='bess-only'?['BESS','EPC']:['Solar Panels','Structure','Inverter','Batteries','BMS','EPC'];
 const phases=phaseNames.map(name=>{const members=allocation.lines.filter((line:any)=>name==='BESS'?line.group==='bess':line.phase===name);const sum=(key:string)=>members.reduce((s,line:any)=>s.add(line[key]??'0'),new Decimal(0)).toFixed(2);return {name,amount:sum(field),approvedDiscount:sum('approvedDiscount'),managementSpecialDiscount:sum('managementSpecialDiscount')};});
 if(phases.reduce((s,p)=>s.add(p.amount),new Decimal(0)).toFixed(2)!==new Decimal(target).toFixed(2))throw new HttpError(422,'Item discount phases do not reconcile with the accepted IPO.');
 return {version:2,saleType:pricing.input.saleType,cashGstTreatment:pricing.input.cashGstTreatment,policy:DISCOUNT_POLICY,presentation:pricing.input.presentation,taxMode:included?'Tax Included':'Show Sales Tax Separately',basis:included?'Tax-inclusive selling values':'Selling values excluding tax',effectivePooledMarkup:null,phases,phaseTotal:target,ipoBeforeTax:allocation.subtotal,ipoTax:allocation.tax,ipoPayable:allocation.total};
}
