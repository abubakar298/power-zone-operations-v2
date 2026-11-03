/** Support can act as staff, never as Management. Enforce the restriction using
 * the authenticated principal, not a browser's selected role or supplied flag. */
export function supportRequestAllowed(url:string,method:string){
 const path=url.split('?')[0];
 if(/^\/api\/(?:accounts\/(?:users|invites|access)|security-events|backups|notification-admin)(?:\/|$)/.test(path))return false;
 if(/(?:standard-policy|pricing-standards|comparison\.pdf|discount-review|management-final|closure-decisions|costing|cost-history|rate-history)/i.test(path))return false;
 if(/^\/api\/accounts-workspace\/(?:job|closures|evidence|return-report|closure-queue)(?:\/|$)/.test(path))return false;
 if(/^\/api\/masters\/(?:rates|rules|specifications)(?:\/|$)/.test(path))return false;
 // Raw source registers and cost-bearing originals are not a support data source.
 if(/\/api\/(?:sources|imports|exports)(?:\/|$)/.test(path))return false;
 return true;
}
const financial=/cost|markup|margin|profit|budget|^actual$|uplift|preapproved|discountstrategy|standarddiscount|pricingpolicy|allocationSource|internalprice|purchaseprice|unitprice/i;
const maps=new Set(['rates','rules','rateVersions','ruleVersions','itemPricing','itemCategories','costing','baseline','budget','actual','markups','policy','discountStrategy']);
/** Defensive projection for nested staff snapshots. Selling/invoice amounts stay
 * available, while internal calculation inputs and priced BOQs stay server-side. */
export function supportCostView(value:any,inCostContext=false):any{
 if(value instanceof Date)return value.toJSON();
 if(Array.isArray(value))return value.map(v=>supportCostView(v,inCostContext));
 if(!value||typeof value!=='object')return value;
 const boq=!!(value.engineering&&value.survey&&Array.isArray(value.lines));
 const result:any={};
 for(const [key,v]of Object.entries(value)){
  if(key==='restrictedCostAccess'){result[key]=false;continue;}
  if(maps.has(key)||financial.test(key)){
   // Keep redacted collection shapes safe for ordinary list rendering.
   result[key]=Array.isArray(v)?[]:v&&typeof v==='object'?{}:null;continue;
  }
  if((boq||inCostContext)&&['rate','total','amount','perWatt','summary'].includes(key)){result[key]=Array.isArray(v)?[]:null;continue;}
  if(key==='rate'&&('phase' in value||'item_key' in value||'itemId' in value)){result[key]=null;continue;}
  result[key]=supportCostView(v,inCostContext||boq);
 }
 return result;
}
