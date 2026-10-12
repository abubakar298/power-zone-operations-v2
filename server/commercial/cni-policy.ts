import {cashDeal,retainedGst,CASH_PROFIT_NOTE} from "./deal.js";
import { Decimal } from "decimal.js";
import { z } from "zod";

/** Cabinet prices are final customer amounts, independent of presentation. */
export const cniPolicy = Object.freeze({
  version: "CNI-2-STANDARD-DISCOUNT", taxRate: "18", standardUnitPayable: "17250000.00",
  minimumUnitPayable: "15500000.00",
});
const input = z.object({
  saleType:z.enum(["Tax Deal","Cash Deal"]).optional(),
  cashGstTreatment:z.enum(["Included in selling price","No GST added"]).optional(),
  quantity: z.number().int().min(1).max(1000),
  discount: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/).default("0"),
  taxRate: z.string().regex(/^\d{1,2}(\.\d{1,4})?$/),
  presentation: z.enum(["Inclusive", "Separate"]),
}).strict();
export type CniPriceInput = z.input<typeof input>;
export function priceCni(raw: unknown) {
  const value = input.parse(raw);
  const rate = new Decimal(value.taxRate);
  if (rate.greaterThan(100)) throw new Error("Invalid GST rate.");
  const standard = new Decimal(cniPolicy.standardUnitPayable).mul(value.quantity);
  const standardDiscount = standard.mul("0.05").toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const discount = new Decimal(value.discount);
  const payable = standard.minus(discount);
  const floor = new Decimal(cniPolicy.minimumUnitPayable).mul(value.quantity);
  if (payable.lessThan(floor)) throw new Error("Below the C&I minimum price. No exception authority has been configured.");
  const beforeTax = cashDeal(value)?payable:payable.div(rate.div(100).plus(1)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const tax = payable.minus(beforeTax);
  return Object.freeze({
    policyVersion: cniPolicy.version, quantity: value.quantity,
    unitPayable: cniPolicy.standardUnitPayable, standardPayable: standard.toFixed(2),
    standardDiscount: standardDiscount.toFixed(2), displayedOffer: standard.add(standardDiscount).toFixed(2),
    discount: discount.toFixed(2), totalDiscount: standardDiscount.add(discount).toFixed(2), payable: payable.toFixed(2),
    beforeTax: beforeTax.toFixed(2), tax: tax.toFixed(2), taxRate: rate.toString(),
    saleType:value.saleType,cashGstTreatment:value.cashGstTreatment,profitNote:retainedGst(value)?CASH_PROFIT_NOTE:undefined,
    presentation: cashDeal(value)?"Inclusive":value.presentation, requiresDiscountApproval: discount.greaterThan(0),
  });
}
/** Do not serialize hidden tax lines in the inclusive customer document. */
export function cniCustomerAmounts(price: ReturnType<typeof priceCni>) {
  return price.presentation === "Separate"
    ? { beforeTax: price.beforeTax, gst: price.tax, payable: price.payable }
    : { payable: price.payable };
}
