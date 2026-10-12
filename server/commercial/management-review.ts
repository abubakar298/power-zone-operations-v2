import { Decimal } from "decimal.js";
import { allocateDiscount, type SellingLine } from "../orders/allocation.js";
import { HttpError } from "../http/errors.js";
const D = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });
export type ReviewAdjustment = { discount: string } | { targetMargin: string } | { targetMarkup: string };
// Preview only: reuse the approved allocation policy; never mutate saved prices or tax policy.
export function managementReview(
  source: SellingLine[],
  subtotal: string,
  solarTax: string,
  otherTax: string,
  costValue: string,
  savedDiscount: string,
  adjustment: ReviewAdjustment,
  cash = false,
) {
  const total = new D(subtotal).add(solarTax).add(otherTax);
  const cost = new D(costValue);
  const allocate = (discount: string) =>
    allocateDiscount(
      source,
      subtotal,
      solarTax,
      otherTax,
      discount,
      total.minus(discount).toFixed(2),
      cash,
    );
  const metrics = (discount: string) => {
    const a = allocate(discount);
    const revenue = new D(a.subtotal);
    const profit = revenue.minus(cost);
    return {
      payable: a.total,
      revenue: revenue.toFixed(2),
      tax: a.tax,
      profit: profit.toFixed(2),
      profitPercent: cost.isZero()
        ? null
        : profit.div(cost).mul(100).toFixed(2),
      marginPercent: revenue.isZero()
        ? null
        : profit.div(revenue).mul(100).toFixed(2),
    };
  };
  const base = allocate("0");
  const maximum = base.lines
    .filter((l) => (l.taxRate === "18" || cash && l.taxRate === "0") && l.group !== "solar")
    .reduce((s, l) => s.add(l.originalTotal), new D(0));
  let discount: string;
  if ("targetMargin" in adjustment || "targetMarkup" in adjustment) {
    const markup = "targetMarkup" in adjustment;
    const value = "targetMarkup" in adjustment ? adjustment.targetMarkup : adjustment.targetMargin;
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(value))
      throw new HttpError(
        422,
        "Enter a target percentage from 0 to 99.99.",
      );
    const target = new D(value);
    if (cost.lte(0))
      throw new HttpError(
        422,
        "Target pricing requires a positive approved cost.",
      );
    const requiredRevenue = markup ? cost.mul(new D(1).add(target.div(100))) : cost.div(new D(1).minus(target.div(100)));
    if (requiredRevenue.gt(subtotal))
      throw new HttpError(
        422,
        "This target requires a price increase. This control only calculates discounts from the standard price.",
      );
    // Search integer paise against the existing allocation's rounded net revenue.
    // Take the largest discount that still meets the requested pre-tax margin.
    let low = new D(0),
      high = maximum.mul(100).floor();
    while (low.lt(high)) {
      const mid = low.add(high).add(1).div(2).floor();
      if (
        new D(allocate(mid.div(100).toFixed(2)).subtotal).gte(requiredRevenue)
      )
        low = mid;
      else high = mid.minus(1);
    }
    discount = low.div(100).toFixed(2);
    const revenue = new D(allocate(discount).subtotal);
    if (revenue.minus(requiredRevenue).gt("0.05"))
      throw new HttpError(
        422,
        "This target exceeds the available discount on eligible items. Solar prices remain unchanged.",
      );
  } else {
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(adjustment.discount))
      throw new HttpError(
        422,
        "Enter a valid discount with at most two decimal places.",
      );
    discount = new D(adjustment.discount).toFixed(2);
  }
  return {
    cost: cost.toFixed(2),
    basis: cash ? "Cash selling price retained in full · markup = profit / approved cost" : "Revenue excluding GST · markup = profit / approved cost",
    original: metrics(savedDiscount),
    proposed: metrics(discount),
    discount,
    maximumDiscount: maximum.toFixed(2),
    targetMargin: "targetMargin" in adjustment ? adjustment.targetMargin : null,
    targetMarkup: "targetMarkup" in adjustment ? adjustment.targetMarkup : null,
  };
}
