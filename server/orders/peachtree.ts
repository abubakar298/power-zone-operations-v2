import { Decimal } from "decimal.js";
import type { BoqSnapshot } from "../boq/engine.js";
import type { PricingSnapshot } from "../commercial/engine.js";
import type { allocateDiscount } from "./allocation.js";
import { HttpError } from "../http/errors.js";
const names = [
  "Solar Panels",
  "Structure",
  "Inverter",
  "Batteries",
  "BMS",
  "EPC",
];
const D = (v: string) => new Decimal(v);
const money = (v: Decimal) =>
  v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
// Integer-cent allocation keeps phase entries equal to the immutable IPO target.
function proportional(total: Decimal, weights: Decimal[]) {
  const sum = weights.reduce((a, b) => a.add(b), D("0"));
  if (total.isNegative() || (sum.isZero() && !total.isZero()))
    throw new HttpError(
      422,
      "Selling value cannot be allocated to the available phase costs.",
    );
  if (sum.isZero()) return weights.map(() => D("0"));
  const exact = weights.map((w) => total.mul(100).mul(w).div(sum)),
    cents = exact.map((v) => v.floor());
  let left = total
    .mul(100)
    .minus(cents.reduce((a, b) => a.add(b), D("0")))
    .toNumber();
  for (const { i } of exact
    .map((v, i) => ({ i, remainder: v.minus(cents[i]) }))
    .sort((a, b) => b.remainder.comparedTo(a.remainder) || a.i - b.i)) {
    if (left-- <= 0) break;
    cents[i] = cents[i].add(1);
  }
  return cents.map((v) => v.div(100));
}
export function peachtreeDivision(
  allocation: ReturnType<typeof allocateDiscount>,
  boq: BoqSnapshot,
  pricing: PricingSnapshot,
  legacyAdditionalCost = "0",
) {
  const included = pricing.input.taxMode === "Tax Included";
  const field = included ? "total" : "beforeTax";
  const target = D(included ? allocation.total : allocation.subtotal);
  const amounts = names.map((_, phase) =>
    allocation.lines
      .filter((_, i) => (phase < 5 ? i === phase : i >= 5))
      .reduce((v, l) => v.add(l[field]), D("0")),
  );
  const phase = (key: string) =>
    key === "Solar PV Modules"
      ? 0
      : key.startsWith("Structure - ")
        ? 1
        : key === boq.inverterConfig.sku
          ? 2
          : key === "BAT-HV-05 KW WO BMS"
            ? 3
            : key === "CH-BMS-HV"
              ? 4
              : 5;
  const costs = names.map((_, i) =>
    boq.lines
      .filter((l) => phase(l.key) === i)
      .reduce((v, l) => v.add(l.total), D("0")),
  );
  costs[5] = costs[5].add(legacyAdditionalCost);
  let policy = "exact-accepted-full-breakup",
    effectiveMarkup: string | null = null;
  if (pricing.input.presentation === "No Breakup") {
    policy = "fixed-solar-10-percent-cost-markup-remainder-proportional";
    amounts[0] = D(money(costs[0].mul(included ? "1.21" : "1.10")));
    proportional(target.minus(amounts[0]), costs.slice(1)).forEach(
      (v, i) => (amounts[i + 1] = v),
    );
  } else if (pricing.input.presentation === "Basic Breakup") {
    policy = "basic-bess-balance-weighted-markup";
    const eligible = allocation.lines.filter(
      (l) => l.group === "bess" || l.group === "balance",
    );
    const pool = eligible.reduce((v, l) => v.add(l[field]), D("0"));
    const poolNet = eligible.reduce((v, l) => v.add(l.beforeTax), D("0"));
    const epcCost = D(pricing.rows.find((r) => r.key === "balance")!.cost);
    const weights = [costs[2], costs[3], costs[4], epcCost];
    const poolCost = weights.reduce((v, w) => v.add(w), D("0"));
    effectiveMarkup = poolCost.isZero()
      ? "0"
      : poolNet.div(poolCost).minus(1).mul(100).toFixed(6);
    const shares = proportional(pool, weights);
    amounts[2] = shares[0];
    amounts[3] = shares[1];
    amounts[4] = shares[2];
    const fixedEpc = allocation.lines
      .filter((l) => l.group === "earthing" || l.group === "additional")
      .reduce((v, l) => v.add(l[field]), D("0"));
    amounts[5] = shares[3].add(fixedEpc);
  }
  if (money(amounts.reduce((v, a) => v.add(a), D("0"))) !== money(target))
    throw new HttpError(
      422,
      "Peachtree phase totals do not reconcile with the IPO.",
    );
  return {
    version: 1,
    policy,
    presentation: pricing.input.presentation,
    taxMode: pricing.input.taxMode,
    basis: included
      ? "Tax-inclusive selling values"
      : "Selling values excluding tax",
    effectivePooledMarkup: effectiveMarkup,
    phases: names.map((name, i) => ({ name, amount: money(amounts[i]) })),
    phaseTotal: money(target),
    ipoBeforeTax: allocation.subtotal,
    ipoTax: allocation.tax,
    ipoPayable: allocation.total,
  };
}
