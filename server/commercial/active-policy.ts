import { Decimal } from "decimal.js";
import { z } from "zod";
import type { BoqSnapshot } from "../boq/engine.js";
import type { PricingInput } from "./schema.js";
import { HttpError } from "../http/errors.js";
export const policyCategories = ["solar", "structure", "earthing", "bess", "other"] as const;
export type PolicyCategory = typeof policyCategories[number];
const percent = z.string().regex(/^\d{1,3}(\.\d{1,4})?$/);
export const commercialPolicySchema = z.object({
  markups: z.object({solar:percent, structure:percent, earthing:percent, bess:percent, other:percent}).strict(),
  costUpliftPercent: percent.optional(),
  preapprovedCostDiscountPercent: percent.optional(),
  itemCategories: z.record(z.string().min(1), z.enum(policyCategories)),
}).strict();
export type CommercialPolicy = z.infer<typeof commercialPolicySchema> & {version:number};
const Exact = Decimal.clone({precision:50});
export function standardItemPrices(boq:BoqSnapshot, input:PricingInput, policy:CommercialPolicy) {
  commercialPolicySchema.parse({markups:policy.markups,itemCategories:policy.itemCategories,costUpliftPercent:policy.costUpliftPercent,preapprovedCostDiscountPercent:policy.preapprovedCostDiscountPercent});
  if(new Set(boq.lines.map(l=>l.key)).size!==boq.lines.length) throw new HttpError(422,"Duplicate BOQ item identities require review.");
  const total=boq.lines.reduce((s,l)=>s.add(l.total),new Exact(0));
  if(!total.eq(boq.total)) throw new HttpError(422,"BOQ item costs do not reconcile with the approved total.");
  return boq.lines.map(line=>{
    const category=line.key==="Additional Item"?input.additionalCategory:policy.itemCategories[line.key];
    if(!category) throw new HttpError(422,`Commercial classification required for ${line.description || line.key}. Select an explicit additional scope category or ask Management to classify this item.`);
    const cost=new Exact(line.total);
    if(!cost.isFinite()||cost.lt(0)) throw new HttpError(422,`Invalid pre-tax cost for ${line.key}.`);
    const markup=policy.markups[category];
    const selling=cost.mul(new Exact(markup).add(policy.costUpliftPercent??0).div(100).add(1));
    // Retain existing tax buckets and quotation group mapping, independently of markup classification.
    const group=line.key==="Additional Item"?"additional":line.phase==="Solar Panels"?"solar":line.phase==="Structure"?"structure":line.phase==="BESS"?"bess":line.epc==="Earthing Cost"?"earthing":"balance";
    const taxRate=group==="additional"?(input.additionalTaxRate??boq.survey.additionalItem?.taxRate??"18"):group==="solar"?"10":"18";
    return {key:line.key,description:line.description,category,group,cost:cost.toString(),markup,beforeTax:selling.toString(),taxRate,tax:selling.mul(taxRate).div(100).toString()};
  });
}
