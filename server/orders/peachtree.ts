import {cashDeal} from "../commercial/deal.js";
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
  const included = cashDeal(pricing.input) || !pricing.input.saleType && pricing.input.taxMode === "Tax Included";
  const taxMode = included?"Tax Included":"Show Sales Tax Separately";
  const field = included ? "total" : "beforeTax";
  const target = D(included ? allocation.total : allocation.subtotal);
  if(boq.survey.family === "direct-product") {
    const phases=names.map(name=>({name,amount:money(allocation.lines.filter(line=>{
      const source=boq.lines.find(l=>l.key===line.description);
      const category=source?.phase === "Solar Panels" ? "Solar Panels" : source?.phase === "Structure" ? "Structure" : /^HYB-/.test(source?.key ?? "") ? "Inverter" : /^BAT-/.test(source?.key ?? "") ? "Batteries" : /^(CH-BMS-|BMS-)/.test(source?.key ?? "") ? "BMS" : "EPC";
      return category === name;
    }).reduce((sum,line)=>sum.add(line[field]),D("0")))}));
    if(!phases.reduce((sum,p)=>sum.add(p.amount),D("0")).eq(target))throw new HttpError(422,"Product classifications do not reconcile with the IPO.");
    return {version:2,saleType:pricing.input.saleType,cashGstTreatment:pricing.input.cashGstTreatment,policy:"exact-accepted-quotation-v2",presentation:pricing.input.presentation,taxMode,basis:included?"Tax-inclusive selling values":"Selling values excluding tax",effectivePooledMarkup:null,phases,phaseTotal:money(target),ipoBeforeTax:allocation.subtotal,ipoTax:allocation.tax,ipoPayable:allocation.total};
  }
  if(boq.survey.family === "bess-only"){
    const phases=[{name:"BESS",amount:money(allocation.lines.filter(l=>l.group==="bess").reduce((v,l)=>v.add(l[field]),D("0")))},{name:"EPC",amount:money(allocation.lines.filter(l=>l.group!=="bess").reduce((v,l)=>v.add(l[field]),D("0")))}];
    if(!D(phases[0].amount).add(phases[1].amount).eq(target))throw new HttpError(422,"BESS/EPC totals do not reconcile with the IPO.");
    return {version:2,saleType:pricing.input.saleType,cashGstTreatment:pricing.input.cashGstTreatment,policy:"exact-accepted-quotation-v2",presentation:pricing.input.presentation,taxMode,basis:included?"Tax-inclusive selling values":"Selling values excluding tax",effectivePooledMarkup:null,phases,phaseTotal:money(target),ipoBeforeTax:allocation.subtotal,ipoTax:allocation.tax,ipoPayable:allocation.total};
  }
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
    saleType:pricing.input.saleType,cashGstTreatment:pricing.input.cashGstTreatment,
    policy,
    presentation: pricing.input.presentation,
    taxMode,
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
