import type {InventoryBatch} from '../server/inventory/operations-batches.js';

/** Seed a new preparation only when all selected sites share one current route.
 * Return fresh dispatch fields; never mutate the Operations resource snapshot. */
export function scheduledTransport(batches:InventoryBatch[],siteIds:string[]){
 const ids=[...new Set(siteIds)];
 if(!ids.length)return null;
 const candidates=batches.filter(batch=>ids.every(id=>batch.stops.some(stop=>stop.siteId===id)));
 if(candidates.length!==1)return null;
 const batch=candidates[0];
 return {batchId:batch.id,batchNumber:batch.number,transport:{issuedTo:'',vehicle:batch.vehicle,driver:batch.driver,driverIdentity:''}};
}
