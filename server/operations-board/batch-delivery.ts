import {z} from 'zod';
/** A route date is a planning projection, never material-issue authority. */
export function plannedInventoryDelivery(site:Record<string,any>):string|null{
 const batches=Array.isArray(site.planningBatches)?site.planningBatches:[];
 for(const batch of [...batches].reverse()){
  const stop=Array.isArray(batch.stops)?batch.stops.find((s:any)=>s.siteId===site.id):undefined;
  if(!stop)continue;
  if((stop.kind??batch.kind)==='labour')continue;
  const date=z.iso.date().safeParse(stop.plannedDate);if(date.success)return date.data;
 }
 const date=z.iso.date().safeParse(site.dispatchDate);return date.success?date.data:null;
}
