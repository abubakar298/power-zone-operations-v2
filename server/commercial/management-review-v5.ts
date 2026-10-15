import{Decimal}from'decimal.js';
import{allocateApprovedDiscount,type DiscountStrategy}from'./discount-strategy.js';
import type{ReviewAdjustment}from'./management-review.js';
import{HttpError}from'../http/errors.js';
/** Targets use the same frozen net-price discount contract as quotation and IPO. */
export function managementReviewV5(strategy:DiscountStrategy,costValue:string,savedDiscount:string,adjustment:ReviewAdjustment,cash=false){
 const cost=new Decimal(costValue),original=allocateApprovedDiscount(strategy,'0');
 const maximum=strategy.items.reduce((s,i)=>s.add(i.approvedAllowance),new Decimal(0)).add(strategy.items.filter(i=>['bess','other'].includes(i.category)&&!['solar','structure','earthing'].includes(i.group)).reduce((s,i)=>s.add(new Decimal(i.beforeTax).sub(i.approvedAllowance)),new Decimal(0))).toDecimalPlaces(2,Decimal.ROUND_HALF_UP);
 const metrics=(discount:string)=>{const a=allocateApprovedDiscount(strategy,discount),revenue=new Decimal(a.subtotal),profit=revenue.sub(cost);return {payable:a.total,revenue:a.subtotal,tax:a.tax,profit:profit.toFixed(2),profitPercent:cost.isZero()?null:profit.div(cost).mul(100).toFixed(2),marginPercent:revenue.isZero()?null:profit.div(revenue).mul(100).toFixed(2),allocation:a};};
 let discount:string;
 if('discount'in adjustment){if(!/^\d{1,12}(\.\d{1,2})?$/.test(adjustment.discount))throw new HttpError(422,'Enter a valid discount with at most two decimal places.');discount=new Decimal(adjustment.discount).toFixed(2);}
 else{const markup='targetMarkup'in adjustment,target=new Decimal(markup?adjustment.targetMarkup:adjustment.targetMargin);
  if(!target.isFinite()||target.isNegative()||!markup&&target.gte(100)||cost.lte(0))throw new HttpError(422,'Enter a valid target and positive approved cost.');
  const required=markup?cost.mul(target.div(100).add(1)):cost.div(new Decimal(1).sub(target.div(100)));
  if(required.gt(original.subtotal))throw new HttpError(422,'This target requires a price increase.');
  discount=new Decimal(original.subtotal).sub(required).mul(100).floor().div(100).toFixed(2);
 }
 if(new Decimal(discount).gt(maximum))throw new HttpError(422,'This target exceeds the approved allowance and eligible BESS/EPC selling capacity.');
 return {cost:cost.toFixed(2),basis:cash?'Cash selling price retained in full · markup = profit / approved cost':'Revenue excluding GST · markup = profit / approved cost',original:metrics(savedDiscount),proposed:metrics(discount),discount,maximumDiscount:maximum.toFixed(2),targetMargin:'targetMargin'in adjustment?adjustment.targetMargin:null,targetMarkup:'targetMarkup'in adjustment?adjustment.targetMarkup:null};
}
