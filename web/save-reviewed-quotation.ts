import {Decimal} from 'decimal.js';
import type {QuotationInput} from '../server/commercial/schema.js';
/** Repriced revisions use the reviewed pricing discount, never the source quote's old override.
 * Copy-only description revisions keep their saved discount unchanged. */
export async function prepareReviewedQuotationInput(input:QuotationInput,request:(path:string,body?:any)=>Promise<any>){
 const current=structuredClone(input);
 if(!current.previewPricing)return current;
 const pricing=await request('/commercial/pricing/preview',current.previewPricing);
 return {...current,discount:pricing.snapshot.discount};
}
/** Persist current form values, then open the saved ID. Never submit an earlier preview/source ID. */
export async function saveReviewedQuotation(options:{input:QuotationInput;requestKey:string;pricingFingerprint?:string;acknowledgePriceChange:boolean;onPreview?:(preview:any,input:QuotationInput)=>void},request:(path:string,body?:any)=>Promise<any>){
 let input=structuredClone(options.input);input.discount=input.discount?.trim()||'0';
 const current=await request('/commercial/quotations/preview',input);
 options.onPreview?.(current,input);
 const comparison=current.snapshot.revision?.comparison;
 if(comparison?.previousPayable&&!new Decimal(comparison.previousPayable).eq(comparison.proposedPayable)&&!options.acknowledgePriceChange)
  throw Error('Review and acknowledge the previous and proposed payable change before saving this revision.');
 if(input.previewPricing){
  const pricing=await request('/commercial/pricing/preview',input.previewPricing);
  if(!options.pricingFingerprint||pricing.fingerprint!==options.pricingFingerprint)throw Error('Pricing changed. Return to Quotation Settings and review the updated prices before saving.');
  const savedPricing=await request('/commercial/pricing',{...input.previewPricing,fingerprint:pricing.fingerprint,requestKey:options.requestKey});
  input={...input,pricingId:savedPricing.id,previewPricing:undefined};
 }
 // Resolve the persisted pricing ID while retaining every edited description/date/term.
 const finalPreview=await request('/commercial/quotations/preview',input);
 if(finalPreview.fingerprint!==current.fingerprint)throw Error('Quotation details changed during saving. Refresh the preview and review them again.');
 const saved=await request('/commercial/quotations',{...input,acknowledgePriceChange:options.acknowledgePriceChange,fingerprint:finalPreview.fingerprint,requestKey:options.requestKey});
 const quotation=await request(`/commercial/quotations/${saved.id}`);
 return {quotation,input};
}
