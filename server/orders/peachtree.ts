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
  const policy = "exact-accepted-quotation-v2";
  const effectiveMarkup = null;
  if (money(amounts.reduce((v, a) => v.add(a), D("0"))) !== money(target))
    throw new HttpError(
      422,
      "Peachtree phase totals do not reconcile with the IPO.",
    );
  return {
    version: 2,
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
