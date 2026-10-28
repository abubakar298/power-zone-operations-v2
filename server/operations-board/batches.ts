import {isDeepStrictEqual} from 'node:util';
import {HttpError} from '../http/errors.js';
import type {BatchInput} from './schema.js';
import {siteBucket,type WorkflowSite} from './workflow.js';
export type BatchSnapshot=Omit<BatchInput,'version'|'requestKey'|'reason'|'id'|'edit'>&{id:string;number:string;createdAt:string;updatedAt:string;plannedBy:string};
export const slot=(stop:BatchInput['stops'][number])=>({start:Date.parse(`${stop.plannedDate}T${stop.start}:00+05:00`),end:Date.parse(`${stop.plannedDate}T${stop.end}:00+05:00`)});
const resource=(value:string)=>value.replace(/[^a-z0-9]/gi,'').toUpperCase();
function overlaps(a:BatchSnapshot,b:BatchSnapshot){return !!(a.vehicle&&b.vehicle&&resource(a.vehicle)===resource(b.vehicle)||a.labourTeam&&a.labourTeam===b.labourTeam&&(a.labourTeam!=='pz-team'||a.team===b.team));}
export function validateBatch(input:BatchInput,sites:WorkflowSite[],existing:BatchSnapshot[],previous?:BatchSnapshot){
 if(input.kind!=='labour'&&!input.vehicle)throw new HttpError(422,'A delivery batch needs a vehicle.');
 if(input.kind!=='delivery'&&!input.labourTeam)throw new HttpError(422,'Choose the shared labour team.');
 if(input.vehicle&&!input.driver)throw new HttpError(422,'Enter the delivery driver’s name.');
 if(previous&&previous.team!==input.team)throw new HttpError(422,'Keep the saved batch team. Reassign sites individually if needed.');
 const stops=[...input.stops].sort((a,b)=>a.order-b.order);
 if(new Set(stops.map(s=>s.siteId)).size!==stops.length||new Set(stops.map(s=>s.order)).size!==stops.length)throw new HttpError(422,'Each site and visit order must be unique.');
 if(previous&&JSON.stringify(previous.stops.map(s=>s.siteId).sort())!==JSON.stringify(stops.map(s=>s.siteId).sort()))throw new HttpError(422,'Keep the sites in the saved batch. Create another batch for additional sites.');
 for(const stop of stops){
  const site=sites.find(s=>s.id===stop.siteId)!;
  if(!previous&&(siteBucket(site)==='completed'||site.scopePending||site.installation===null||input.kind==='labour'&&site.installation!==true||input.kind!=='labour'&&(!['received','awaiting'].includes(site.stage)||input.kind==='both'&&site.installation!==true)))throw new HttpError(422,`${site.name} is not eligible for this batch.`);
  if(site.operationsTeam&&site.operationsTeam!==input.team)throw new HttpError(422,'A selected site belongs to another Operations team.');
  const times=slot(stop);if(!Number.isFinite(times.start)||times.end<=times.start)throw new HttpError(422,'Enter a valid start and end slot for each site.');
  if(input.kind==='labour'&&site.deliveryDate&&stop.plannedDate<site.deliveryDate)throw new HttpError(422,'Labour cannot be scheduled before delivery.');
 }
 for(let n=1;n<stops.length;n++)if(slot(stops[n]).start<slot(stops[n-1]).end)throw new HttpError(422,'Visit slots overlap or run against the route order.');
 const business=(value:BatchInput|BatchSnapshot)=>({team:value.team,kind:value.kind,vehicle:value.vehicle,driver:value.driver,labourTeam:value.labourTeam,inventoryReference:value.inventoryReference,stops:[...value.stops].sort((a,b)=>a.order-b.order).map(({siteVersion,...stop})=>stop)});
 if(previous&&isDeepStrictEqual(business(previous),business(input)))throw new HttpError(422,'No batch decisions changed.');
 const candidate={...input,id:previous?.id??'',number:previous?.number??'',createdAt:'',updatedAt:'',plannedBy:''};
 for(const other of existing.filter(b=>b.id!==input.id))if(overlaps(candidate,other))for(const stop of stops)for(const booked of other.stops)if(slot(stop).start<slot(booked).end&&slot(booked).start<slot(stop).end)throw new HttpError(409,'A shared resource is already booked during this slot.');
 return stops;
}
