/** Identity candidates only. No fuzzy name matching, shared-number allocation,
 * stock movement or implied authorisation from a reporting register. */
export type RegisteredMaterialSite={id:string;ipo:string;name:string;customerPo?:string;stage:string;completed?:boolean;sample?:boolean;cancelled?:boolean;transferred?:boolean;archived?:boolean;superseded?:boolean};
/** attachedPoNumber: the latest customer PO Coordination attached after the IPO was issued; it replaces the IPO's PO. */
export type IssuedMaterialIdentity={id:string;number:string;orderNumber:string;poNumber:string;attachedPoNumber?:string;siteName:string};
export type MaterialLinkCheck={status:'eligible'|'not-pending'|'missing-ipo'|'ambiguous-ipo'|'missing-po'|'po-mismatch'|'site-name-review';ipoId?:string};
const text=(value:string|undefined)=>(value??'').trim().replace(/\s+/g,' ').toLowerCase();
export function checkMaterialSourceLink(site:RegisteredMaterialSite,ipos:IssuedMaterialIdentity[],continuingInstallation:boolean|'historical-delivered'=false,exactLiveHandoff=false):MaterialLinkCheck{
 const historical=continuingInstallation==='historical-delivered';
 if(site.sample||site.completed&&!historical||site.cancelled||site.transferred||site.archived||site.superseded||!(historical?['delivered','completed'].includes(site.stage):['received','awaiting'].includes(site.stage)||(continuingInstallation&&site.stage==='delivered')))return {status:'not-pending'};
 const [number,...rest]=site.ipo.split(' · '),order=rest.join(' · ');
 const hits=ipos.filter(r=>text(r.number)===text(number)&&text(r.orderNumber)===text(order));
 if(!hits.length)return {status:'missing-ipo'};
 if(hits.length!==1)return {status:'ambiguous-ipo'};
 const ipo=hits[0],base={ipoId:ipo.id};
 // The board may show the IPO's PO or, once Coordination attached one later, that PO (older sites keep the IPO's).
 const ipoPos=[ipo.poNumber,ipo.attachedPoNumber].map(text).filter(Boolean);
 if((!text(site.customerPo)||!ipoPos.length)&&!(exactLiveHandoff&&!text(site.customerPo)&&!ipoPos.length))return {...base,status:'missing-po'};
 if(!ipoPos.includes(text(site.customerPo)))return {...base,status:'po-mismatch'};
 if(!text(site.name)||text(site.name)!==text(ipo.siteName))return {...base,status:'site-name-review'};
 return {...base,status:'eligible'};
}
