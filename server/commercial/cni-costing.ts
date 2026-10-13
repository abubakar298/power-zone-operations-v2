import { Decimal } from "decimal.js";
import { priceCni } from "./cni-policy.js";
/** Server-only internal cost. Never import into the employee/customer presentation. */
export const cniInternalCost = Object.freeze({version:"CNI-COST-1",unitBeforeTax:"11000000.00"});
export type CniCostSnapshot={version:string;unitBeforeTax:string;quantity:number;totalBeforeTax:string};
export function snapshotCniCost(quantity:number):CniCostSnapshot {
 return {...cniInternalCost,quantity,totalBeforeTax:new Decimal(cniInternalCost.unitBeforeTax).mul(quantity).toFixed(2)};
}
export function reviewCni(pricing:ReturnType<typeof priceCni>,cost:CniCostSnapshot,adjustment?:{discount:string}|{targetMarkup:string}) {
 const budget=new Decimal(cost.totalBeforeTax);
 let discount=pricing.discount;
 if(adjustment&&"discount" in adjustment)discount=adjustment.discount;
 if(adjustment&&"targetMarkup" in adjustment){
  if(!/^\d{1,3}(\.\d{1,2})?$/.test(adjustment.targetMarkup))throw new Error("Enter a valid target markup percentage.");
  const required=budget.mul(new Decimal(adjustment.targetMarkup).div(100).plus(1)).mul(pricing.saleType === "Cash Deal"?1:new Decimal(pricing.taxRate).div(100).plus(1)).toDecimalPlaces(2,Decimal.ROUND_HALF_UP);
  const reduction=new Decimal(pricing.standardPayable).minus(required);
  if(reduction.isNegative())throw new Error("Target markup exceeds the standard selling price.");
  discount=reduction.toFixed(2);
 }
 const proposed=priceCni({saleType:pricing.saleType,cashGstTreatment:pricing.cashGstTreatment,quantity:pricing.quantity,presentation:pricing.presentation,taxRate:pricing.taxRate,discount});
 const metrics=(p:ReturnType<typeof priceCni>)=>{
  const profit=new Decimal(p.beforeTax).minus(budget);
  return {profitNote:p.profitNote,cost:budget.toFixed(2),profit:profit.toFixed(2),beforeTax:p.beforeTax,tax:p.tax,payable:p.payable,discount:p.discount,markup:profit.div(budget).mul(100).toFixed(2)};
 };
 return {costVersion:cost.version,unitCostBeforeTax:cost.unitBeforeTax,original:metrics(pricing),proposed:metrics(proposed),recommendedDiscount:proposed.discount};
}
