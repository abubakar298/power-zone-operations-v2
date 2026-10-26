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
/** Current quotations discount selling before GST; legacy allocations remain unchanged. */
export function allocateBeforeTaxDiscount(source:SellingLine[],subtotal:string,tax10:string,tax18:string,discount:string,netTotal:string,acceptedTax10:string,acceptedTax18:string){
 if(!source.length||source.some(line=>!['0','10','18'].includes(line.taxRate)||D(line.beforeTax).isNegative()||D(line.qty).isNegative()))throw new HttpError(422,'Invalid approved quotation selling lines.');
 const base=distribute(D(subtotal).mul(100),source.map(line=>D(line.beforeTax).mul(100)));
 const discountCents=D(discount).mul(100);
 if(!discountCents.isInteger()||discountCents.isNegative()||discountCents.gt(D(subtotal).mul(100)))throw new HttpError(422,'Invalid before-tax discount.');
 const shares=distribute(discountCents,base),afterBase=base.map((value,i)=>value.sub(shares[i]));
 const originalTax=source.map(()=>D('0')),afterTax=source.map(()=>D('0'));
 for(const [rate,original,accepted] of [['10',tax10,acceptedTax10],['18',tax18,acceptedTax18]]){
  const weights=source.map((line,i)=>line.taxRate===rate?afterBase[i]:D('0'));
  const expected=weights.reduce((sum,value)=>sum.add(value),D('0')).div(100).mul(D(rate).div(100));
  if(D(accepted).sub(expected).abs().gt('0.02'))throw new HttpError(422,'Accepted quotation GST does not reconcile with discounted selling.');
  distribute(D(original).mul(100),source.map((line,i)=>line.taxRate===rate?base[i]:D('0'))).forEach((value,i)=>originalTax[i]=originalTax[i].add(value));
  distribute(D(accepted).mul(100),weights).forEach((value,i)=>afterTax[i]=afterTax[i].add(value));
 }
 const rounding=D(netTotal).mul(100).sub(afterBase.reduce((sum,value,i)=>sum.add(value).add(afterTax[i]),D('0')));
 if(!rounding.isInteger()||rounding.abs().gt(2))throw new HttpError(422,'Accepted quotation total does not reconcile with its discount and GST.');
 const roundingIndex=afterBase.findLastIndex(value=>value.gt(0));
 if(roundingIndex<0&&!rounding.isZero())throw new HttpError(422,'No selling row for the approved rounding adjustment.');
 if(roundingIndex>=0)afterBase[roundingIndex]=afterBase[roundingIndex].add(rounding);
 const lines=source.map((line,i)=>({...line,originalBeforeTax:money(base[i].div(100)),originalTax:money(originalTax[i].div(100)),originalTotal:money(base[i].add(originalTax[i]).div(100)),allocatedDiscount:money(shares[i].div(100)),beforeTaxReduction:money(shares[i].div(100)),taxReduction:money(originalTax[i].sub(afterTax[i]).div(100)),beforeTax:money(afterBase[i].div(100)),tax:money(afterTax[i].div(100)),total:money(afterBase[i].add(afterTax[i]).div(100)),rate:D(line.qty).gt(0)?afterBase[i].div(100).div(line.qty).toFixed(6):'0.000000',taxRoundingAdjustment:'0.00'}));
 const sum=(key:'beforeTax'|'tax'|'total')=>money(lines.reduce((value,line)=>value.add(line[key]),D('0')));
 return {policy:'accepted-before-tax-discount-v2',originalSubtotal:subtotal,originalTax10:tax10,originalTax18:tax18,originalDiscount:discount,roundingAdjustment:money(rounding.div(100)),lines,subtotal:sum('beforeTax'),tax:sum('tax'),total:sum('total')};
}
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
