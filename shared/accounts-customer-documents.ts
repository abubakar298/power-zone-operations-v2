export type CustomerDocumentKind='Signed DO'|'VSO'|'Acknowledgment';
export type AccountsCustomerDocument={id:string;siteId:string;siteName:string;customer:string;ipo:string;jobKey?:string;kind:CustomerDocumentKind;filename:string;receivedAt:string;documentDate:string|null;source:'QC'|'Site sign-off';sourceVersion:number;downloadUrl:string};
export type AccountsCustomerDocumentSite={siteId:string;siteName:string;customer:string;ipo:string;receivedAt:string;documents:AccountsCustomerDocument[]};
/** Stable site identity groups partial delivery DOs without merging shared IPO numbers. */
export function groupAccountsCustomerDocuments(rows:AccountsCustomerDocument[]):AccountsCustomerDocumentSite[]{
 const sites=new Map<string,AccountsCustomerDocumentSite>();
 for(const d of rows){let site=sites.get(d.siteId);if(!site){site={siteId:d.siteId,siteName:d.siteName,customer:d.customer,ipo:d.ipo,receivedAt:d.receivedAt,documents:[]};sites.set(d.siteId,site);}site.documents.push(d);if(d.receivedAt>site.receivedAt)site.receivedAt=d.receivedAt;}
 return [...sites.values()].map(s=>({...s,documents:s.documents.sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)||a.id.localeCompare(b.id))})).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)||a.siteId.localeCompare(b.siteId));
}
