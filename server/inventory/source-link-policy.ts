/** Identity candidates only. No fuzzy name matching, shared-number allocation,
 * stock movement or implied authorisation from a reporting register. */
export type RegisteredMaterialSite={id:string;ipo:string;name:string;customerPo?:string;stage:string;completed?:boolean;sample?:boolean;cancelled?:boolean;transferred?:boolean;archived?:boolean;superseded?:boolean};
export type IssuedMaterialIdentity={id:string;number:string;orderNumber:string;poNumber:string;siteName:string};
export type MaterialLinkCheck={status:'eligible'|'not-pending'|'missing-ipo'|'ambiguous-ipo'|'missing-po'|'po-mismatch'|'site-name-review';ipoId?:string};
const text=(value:string|undefined)=>(value??'').trim().replace(/\s+/g,' ').toLowerCase();
export function checkMaterialSourceLink(site:RegisteredMaterialSite,ipos:IssuedMaterialIdentity[],continuingInstallation=false):MaterialLinkCheck{
 if(site.sample||site.completed||site.cancelled||site.transferred||site.archived||site.superseded||!(['received','awaiting'].includes(site.stage)||(continuingInstallation&&site.stage==='delivered')))return {status:'not-pending'};
 const [number,...rest]=site.ipo.split(' · '),order=rest.join(' · ');
 const hits=ipos.filter(r=>text(r.number)===text(number)&&text(r.orderNumber)===text(order));
 if(!hits.length)return {status:'missing-ipo'};
 if(hits.length!==1)return {status:'ambiguous-ipo'};
 const ipo=hits[0],base={ipoId:ipo.id};
 if(!text(site.customerPo)||!text(ipo.poNumber))return {...base,status:'missing-po'};
 if(text(site.customerPo)!==text(ipo.poNumber))return {...base,status:'po-mismatch'};
 if(!text(site.name)||text(site.name)!==text(ipo.siteName))return {...base,status:'site-name-review'};
 return {...base,status:'eligible'};
}
