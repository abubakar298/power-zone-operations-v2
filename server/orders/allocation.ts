import { Decimal } from "decimal.js";
import { HttpError } from "../http/errors.js";

export interface SellingLine {
  description: string;
  qty: string;
  unit: string;
  beforeTax: string;
  taxRate: string;
  group: string;
}
const D = (v: string) => new Decimal(v);
const money = (v: Decimal) =>
  v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
// Largest-remainder allocation works in integer cents and never over-allocates a row.
function distribute(total: Decimal, weights: Decimal[]): Decimal[] {
  const sum = weights.reduce((a, b) => a.add(b), D("0"));
  if (sum.isZero()) {
    if (!total.isZero())
      throw new HttpError(
        422,
        "No eligible selling amount for this allocation.",
      );
    return weights.map(() => D("0"));
  }
  const exact = weights.map((w) => total.mul(w).div(sum));
  const result = exact.map((x) => x.floor());
  let remaining = total
    .minus(result.reduce((a, b) => a.add(b), D("0")))
    .toNumber();
  const order = exact
    .map((x, i) => ({ i, fraction: x.minus(result[i]) }))
    .sort((a, b) => b.fraction.comparedTo(a.fraction) || a.i - b.i);
  for (const entry of order) {
    if (remaining-- <= 0) break;
    result[entry.i] = result[entry.i].add(1);
  }
  return result;
}

export function allocateDiscount(
  source: SellingLine[],
  subtotal: string,
  tax10: string,
  tax18: string,
  discount: string,
  netTotal: string,
  cash = false,
) {
  if (
    !source.length ||
    source.some(
      (l) =>
        !["0", "10", "18"].includes(l.taxRate) ||
        !D(l.beforeTax).isFinite() ||
        D(l.beforeTax).isNegative() ||
        D(l.qty).isNegative(),
    )
  )
    throw new HttpError(422, "Invalid approved quotation selling lines.");
  const baseCents = source.map((l) => D(l.beforeTax).mul(100));
  const base = distribute(D(subtotal).mul(100), baseCents);
  const originalTax = source.map(() => D("0"));
  for (const [rate, total] of [
    ["10", tax10],
    ["18", tax18],
  ]) {
    const weights = source.map((l, i) =>
      l.taxRate === rate ? base[i] : D("0"),
    );
    distribute(D(total).mul(100), weights).forEach(
      (v, i) => (originalTax[i] = originalTax[i].add(v)),
    );
  }
  const gross = base.map((v, i) => v.add(originalTax[i]));
  const eligible = gross.map((v, i) =>
    (source[i].taxRate === "18" || cash && source[i].taxRate === "0") && source[i].group !== "solar" ? v : D("0"),
  );
  const maximum = eligible.reduce((a, b) => a.add(b), D("0"));
  const discountCents = D(discount).mul(100);
  if (
    discountCents.isNegative() ||
    !discountCents.isInteger() ||
    discountCents.gt(maximum)
  )
    throw new HttpError(
      422,
      "Discount exceeds the tax-inclusive value of eligible 18% items. Solar and other tax categories remain unchanged.",
    );
  const shares = distribute(discountCents, eligible);
  const result = source.map((l, i) => {
    const after = gross[i].minus(shares[i]);
    // Derive net from the exact discounted gross, rather than rounding a tax-exclusive
    // discount independently. The residual is explicit reporting data, not a hidden change.
    const adjustedBase = shares[i].isZero()
      ? base[i]
      : cash ? after : after.div("1.18").toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    const adjustedTax = after.minus(adjustedBase);
    const expectedTax = adjustedBase
      .mul(D(l.taxRate).div(100))
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    return {
      ...l,
      originalBeforeTax: money(base[i].div(100)),
      originalTax: money(originalTax[i].div(100)),
      originalTotal: money(gross[i].div(100)),
      allocatedDiscount: money(shares[i].div(100)),
      beforeTaxReduction: money(base[i].minus(adjustedBase).div(100)),
      taxReduction: money(originalTax[i].minus(adjustedTax).div(100)),
      beforeTax: money(adjustedBase.div(100)),
      tax: money(adjustedTax.div(100)),
      total: money(after.div(100)),
      rate: D(l.qty).gt(0)
        ? adjustedBase.div(100).div(l.qty).toFixed(6)
        : "0.000000",
      taxRoundingAdjustment: money(adjustedTax.minus(expectedTax).div(100)),
    };
  });
  const sum = (field: "beforeTax" | "tax" | "total" | "allocatedDiscount") =>
    money(result.reduce((a, l) => a.add(l[field]), D("0")));
  if (
    sum("total") !== money(D(netTotal)) ||
    sum("allocatedDiscount") !== money(D(discount))
  )
    throw new HttpError(
      422,
      "Quotation totals do not reconcile with its approved selling amounts.",
    );
  return {
    policy: "solar-unchanged-18-percent-proportional-v1",
    originalSubtotal: subtotal,
    originalTax10: tax10,
    originalTax18: tax18,
    originalDiscount: discount,
    lines: result,
    subtotal: sum("beforeTax"),
    tax: sum("tax"),
    total: sum("total"),
  };
}
