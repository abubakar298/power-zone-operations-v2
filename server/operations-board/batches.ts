import {isArchivedLegacySolar} from '../../shared/legacy-solar-archive.js';
import {isDeepStrictEqual} from 'node:util';
import {HttpError} from '../http/errors.js';
import type {BatchInput} from './schema.js';
import {siteBucket,type WorkflowSite} from './workflow.js';
export type BatchSnapshot=Omit<BatchInput,'version'|'requestKey'|'reason'|'id'|'edit'|'cancelledSites'>&{id:string;number:string;createdAt:string;updatedAt:string;plannedBy:string};
export const slot=(stop:BatchInput['stops'][number])=>({start:Date.parse(`${stop.plannedDate}T${stop.start||'00:00'}:00+05:00`),end:stop.end?Date.parse(`${stop.plannedDate}T${stop.end}:00+05:00`):Date.parse(`${stop.plannedDate}T00:00:00+05:00`)+86400000});
const resource=(value:string)=>value.replace(/[^a-z0-9]/gi,'').toUpperCase();
function bookings(batch:BatchSnapshot){
 const result:{key:string;start:number;end:number}[]=[];
 for(const stop of batch.stops){const kind=stop.kind??batch.kind;
 if(kind!=='labour'&&batch.vehicle){const date=batch.deliveryDate;if(date)result.push({key:'vehicle:'+resource(batch.vehicle),...slot({...stop,plannedDate:date,start:'',end:''})});}
 if(kind!=='delivery'&&batch.labourTeam&&stop.plannedDate)result.push({key:'labour:'+batch.labourTeam+(batch.labourTeam==='pz-team'?':'+batch.team:''),...slot(stop)});
 }return result;
}
export function validateBatch(input:BatchInput,sites:WorkflowSite[],existing:BatchSnapshot[],previous?:BatchSnapshot){
 if(!previous&&input.stops.length<2)throw new HttpError(422,'Choose at least two sites for a new batch.');
 const kinds=input.stops.map(stop=>stop.kind??input.kind);
 const aggregate=kinds.every(k=>k==='labour')?'labour':kinds.every(k=>k==='delivery')?'delivery':'both';
 if(input.kind!==aggregate)throw new HttpError(422,'Batch resources must match the selected site visit types.');
 if(kinds.some(kind=>kind!=='labour')&&!input.vehicle)throw new HttpError(422,'A delivery batch needs a vehicle.');
 if(kinds.some(kind=>kind!=='delivery')&&!input.labourTeam)throw new HttpError(422,'Choose the shared labour team.');
 if(input.vehicle&&!input.driver)throw new HttpError(422,'Enter the delivery driver’s name.');
 if(previous&&previous.team!==input.team)throw new HttpError(422,'Keep the saved batch team. Reassign sites individually if needed.');
 if(kinds.some(kind=>kind!=='labour')&&!input.deliveryDate)throw new HttpError(422,'Select one delivery date for the whole batch.');
 const stops=[...input.stops].sort((a,b)=>a.order-b.order);
 if(new Set(stops.map(s=>s.siteId)).size!==stops.length||new Set(stops.map(s=>s.order)).size!==stops.length)throw new HttpError(422,'Each site and visit order must be unique.');
 const removed=previous?.stops.filter(saved=>!stops.some(stop=>stop.siteId===saved.siteId))??[];
 if(new Set(input.cancelledSites.map(s=>s.siteId)).size!==input.cancelledSites.length||removed.length!==input.cancelledSites.length||input.cancelledSites.some(s=>!removed.some(r=>r.siteId===s.siteId)))throw new HttpError(422,'Explicitly cancel each removed site from this batch.');
 for(const stop of removed){const site=sites.find(s=>s.id===stop.siteId);if(!site||siteBucket(site)==='completed'||(stop.kind??previous!.kind)!=='labour'&&site.stage==='delivered')throw new HttpError(409,'Completed or delivered batch work needs Management review before cancellation.');}
 for(const stop of stops){
  const site=sites.find(s=>s.id===stop.siteId);
  if(!site)throw new HttpError(422,'A selected site is unavailable.');
  const kind=stop.kind??input.kind;
  const oldStop=previous?.stops.find(s=>s.siteId===stop.siteId);
  if(isArchivedLegacySolar(site)&&!oldStop)throw new HttpError(409,'Archived legacy Solar sites are unavailable for new batch work.');
  const changesWork=!previous||!oldStop||(oldStop.kind??previous.kind)!==kind;
  if(changesWork&&(siteBucket(site)==='completed'||site.scopePending||site.installation===null||kind==='labour'&&site.installation!==true||kind!=='labour'&&(!['received','awaiting'].includes(site.stage)||kind==='both'&&site.installation!==true)))throw new HttpError(422,`${site.name} is not eligible for this batch.`);
  if(site.operationsTeam&&site.operationsTeam!==input.team)throw new HttpError(422,'A selected site belongs to another Operations team.');
  if(Boolean(stop.start)!==Boolean(stop.end))throw new HttpError(422,'Provide both optional times or leave both blank.');
  if(site.installation!==false&&!stop.plannedDate)throw new HttpError(422,'Enter the expected installation date for each installation site.');
  if(kind!=='labour'&&stop.plannedDate&&input.deliveryDate&&stop.plannedDate<input.deliveryDate)throw new HttpError(422,'Expected installation cannot be before batch delivery.');
  const times=slot({...stop,plannedDate:stop.plannedDate||input.deliveryDate!});if(!Number.isFinite(times.start)||times.end<=times.start)throw new HttpError(422,'Enter a valid start and end slot for each site.');
  if(kind==='labour'&&site.deliveryDate&&stop.plannedDate<site.deliveryDate)throw new HttpError(422,'Labour cannot be scheduled before delivery.');
 }
 for(let n=1;n<stops.length;n++){if(stops[n].plannedDate&&stops[n-1].plannedDate&&stops[n].plannedDate<stops[n-1].plannedDate)throw new HttpError(422,'Visit dates run against the route order.');if(stops[n].start&&stops[n-1].end&&slot(stops[n]).start<slot(stops[n-1]).end)throw new HttpError(422,'Visit slots overlap or run against the route order.');}
 const business=(value:BatchInput|BatchSnapshot)=>({deliveryDate:value.deliveryDate,team:value.team,kind:value.kind,vehicle:value.vehicle,driver:value.driver,labourTeam:value.labourTeam,inventoryReference:value.inventoryReference,stops:[...value.stops].sort((a,b)=>a.order-b.order).map(({siteVersion,...stop})=>({...stop,kind:stop.kind??value.kind}))});
 if(previous&&isDeepStrictEqual(business(previous),business(input)))throw new HttpError(422,'No batch decisions changed.');
 const candidate={...input,id:previous?.id??'',number:previous?.number??'',createdAt:'',updatedAt:'',plannedBy:''};
 for(const other of existing.filter(b=>b.id!==input.id))for(const a of bookings(candidate))for(const b of bookings(other))if(a.key===b.key&&a.start<b.end&&b.start<a.end)throw new HttpError(409,'A shared resource is already booked on this visit date or time.');
 return stops;
}
