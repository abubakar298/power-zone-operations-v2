import type {MaterialSource} from './material-drafts.js';
export type InventoryBatch={id:string;number:string;version:number;team:string;vehicle:string;driver:string;stops:{boardSiteId:string;siteId?:string;name:string;ipo:string;date:string;work:'delivery'|'both';status:'ready'|'fixed-only'|'approved-boq-required'}[]};
/** Read-only handoff. A route is never a substitute for approved material authority. */
export function inventoryOperationsBatches(batches:{version:number;snapshot:any}[],boards:{site_id:string;snapshot:any}[],sources:MaterialSource[]):InventoryBatch[]{
 const sites=new Map(boards.map(row=>[row.site_id,row.snapshot]));
 return batches.flatMap(({version,snapshot:batch})=>{
  const stops:InventoryBatch['stops']=[];
  for(const stop of batch.stops??[]){
   const site=sites.get(stop.siteId),work=stop.kind??batch.kind;
   if(work==='labour'||!site||site.sample===true||site.completed||!['received','awaiting'].includes(site.stage)||site.operationsTeam!==batch.team)continue;
   // Full returns clear effective route links. Do not resurrect an old dispatch.
   if(!site.planningBatches?.some((link:any)=>link.id===batch.id&&link.stops?.some((own:any)=>own.siteId===stop.siteId&&own.plannedDate===stop.plannedDate)))continue;
   const matches=sources.filter(source=>source.registeredSiteId===stop.siteId&&source.authorization!=='forecast-only');
   const source=matches.length===1?matches[0]:undefined;
   stops.push({boardSiteId:stop.siteId,siteId:source?.siteId,name:site.name,ipo:site.ipo,date:batch.deliveryDate??'',work,status:!source||source.installation===null?'approved-boq-required':source.installation===false?'fixed-only':'ready'});
  }
  return stops.length?[{id:batch.id,number:batch.number,version,team:batch.team,vehicle:batch.vehicle??'',driver:batch.driver??'',stops}]:[];
 });
}
