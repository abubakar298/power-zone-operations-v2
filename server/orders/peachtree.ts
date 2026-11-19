import {cashDeal} from "../commercial/deal.js";
import { Decimal } from "decimal.js";
import type { BoqSnapshot } from "../boq/engine.js";
import type { PricingSnapshot } from "../commercial/engine.js";
import type { allocateDiscount } from "./allocation.js";
import { HttpError } from "../http/errors.js";
import { bessPtPhases, ptPhaseOf } from "./pt-detail.js";
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
  // Allocation lines carry the saved BOQ item's key or description, or the quotation text "<brand> <specification>";
  // find the item to know its PT row (exact match first, then the longest specification the text ends with).
  const spec=(l:any)=>String(l.specification??"");
  const sourceOf=(line:{description:string})=>boq.lines.find(l=>l.key===line.description)??boq.lines.find(l=>l.description===line.description)??boq.lines.find(l=>spec(l)===line.description)??
    boq.lines.filter(l=>spec(l).length>0&&line.description.endsWith(" "+spec(l))).sort((a,b)=>spec(b).length-spec(a).length)[0];
  if(boq.survey.family === "direct-product") {
    // Inverters, batteries and BMS (including CHINT CH-PCS-/CH-BAT- items) always get their own PT rows.
    const phases=names.map(name=>({name,amount:money(allocation.lines.filter(line=>{
      const source=sourceOf(line);
      const phase=source?ptPhaseOf(source):"EPC";
      const category=phase === "BESS" ? "EPC" : phase;
      return category === name;
    }).reduce((sum,line)=>sum.add(line[field]),D("0")))}));
    if(!phases.reduce((sum,p)=>sum.add(p.amount),D("0")).eq(target))throw new HttpError(422,"Product classifications do not reconcile with the IPO.");
    return {version:2,saleType:pricing.input.saleType,cashGstTreatment:pricing.input.cashGstTreatment,policy:"exact-accepted-quotation-v2",presentation:pricing.input.presentation,taxMode,basis:included?"Tax-inclusive selling values":"Selling values excluding tax",effectivePooledMarkup:null,phases,phaseTotal:money(target),ipoBeforeTax:allocation.subtotal,ipoTax:allocation.tax,ipoPayable:allocation.total};
  }
  if(boq.survey.family === "bess-only"){
    // Inverter, batteries and BMS each get their own PT row; "BESS" keeps any other BESS item only.
    const bess=allocation.lines.filter(l=>l.group==="bess");
    const bessPhase=(line:{description:string})=>{const source=sourceOf(line);const phase=source?ptPhaseOf(source):"BESS";return ["Inverter","Batteries","BMS"].includes(phase)?phase:"BESS";};
    const phases=[...bessPtPhases.map(name=>({name,members:bess.filter(l=>bessPhase(l)===name)})).filter(p=>p.name!=="BESS"||p.members.length>0).map(p=>({name:p.name,amount:money(p.members.reduce((v,l)=>v.add(l[field]),D("0")))})),{name:"EPC",amount:money(allocation.lines.filter(l=>l.group!=="bess").reduce((v,l)=>v.add(l[field]),D("0")))}];
    if(!phases.reduce((v,p)=>v.add(p.amount),D("0")).eq(target))throw new HttpError(422,"BESS/EPC totals do not reconcile with the IPO.");
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
