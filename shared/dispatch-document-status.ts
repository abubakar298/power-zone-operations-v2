export type DispatchDocument={label:'Signed DO'|'Variable Items Sign Off'|'Acknowledgment';fileId?:string;source?:'qc'|'warehouse';boardId?:string;note?:string};
export type DispatchDocumentRow={id:string;number:string;draftId:string;warehouse:string;createdAt:string;parent:boolean;retrospective?:boolean;preparationIds?:string[];preparationKinds?:Record<string,string>;reviewNote?:string;status:'awaiting'|'ready';reconciliationStatus:string;sites:{siteId:string;registeredSiteId?:string;usageReady?:boolean;installation?:boolean;usageNote?:string;dispatchComplete?:boolean;name:string;customer:string;ipo:string;documents:DispatchDocument[]}[]};

export type DispatchDocumentSiteRow={id:string;name:string;customer:string;ipo:string;createdAt:string;status:'awaiting'|'ready';dispatches:{dispatch:DispatchDocumentRow;site:DispatchDocumentRow['sites'][number]}[]};
/** One exact site across partial deliveries and Parent DOs; any missing required copy keeps it awaiting. */
export function groupDispatchDocumentSites(rows:DispatchDocumentRow[]):DispatchDocumentSiteRow[]{
 const sites=new Map<string,DispatchDocumentSiteRow>();
 for(const dispatch of [...rows].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)))for(const original of dispatch.sites){
  const site={...original,documents:original.documents.filter(d=>d.label!=='Acknowledgment')};
  if(site.installation===false&&site.documents.every(d=>d.fileId))continue;
  const id=site.registeredSiteId||site.siteId;
  let row=sites.get(id);
  if(!row){row={id,name:site.name,customer:site.customer,ipo:site.ipo,createdAt:dispatch.createdAt,status:'ready',dispatches:[]};sites.set(id,row);}
  if(row.dispatches.some(d=>d.dispatch.id===dispatch.id))continue;
  row.dispatches.push({dispatch,site});
  if(site.documents.some(d=>!d.fileId)||site.usageReady===false)row.status='awaiting';
 }
 return [...sites.values()];
}
