import type {z} from 'zod';
import {targetsSchema,type targetStageIds} from './schema.js';
import {qcType,qcStagesFor,siteBucket,type WorkflowSite} from './workflow.js';
export type StageTargets=Partial<z.infer<typeof targetsSchema>['values']>;
export type Delay={id:string;siteId:string;stage:string;due:string;hoursOverdue:number;basis:string};
const dayEnd=(value:string)=>Date.parse(value+'T23:59:59+05:00');
const stamp=(entry:{recordedAt?:string;date?:string}|undefined)=>entry?.recordedAt?{at:Date.parse(entry.recordedAt),precise:true}:entry?.date?{at:dayEnd(entry.date),precise:false}:null;
const finishedAndSubmitted=(site:WorkflowSite)=>siteBucket(site)==='completed'&&(site.documentsSubmittedToAccounts===true||!!site.documentsSubmittedToAccountsAt||!!site.documents?.length&&site.documents.every(d=>d.location==='Submitted to Accounts'||d.submittedToAccounts===true||!!d.submittedToAccountsAt));
/** Date-only historical facts use their latest possible start; never fabricate hours. */
export function siteDelays(site:WorkflowSite,values:StageTargets,now:string):Delay[]{
 const time=Date.parse(now),delays:Delay[]=[];
 if(finishedAndSubmitted(site))return delays;
 const add=(key:string,stage:string,due:number,basis:string)=>{if(Number.isFinite(due)&&time>due)delays.push({id:`${site.id}:delay:${key}`,siteId:site.id,stage,due:new Date(due).toISOString(),hoursOverdue:Math.round((time-due)/3600000*10)/10,basis});};
 if(siteBucket(site)!=='completed'){
  let key:string=site.stage,label=site.stage==='received'?'Team & vendor assignment':'Awaiting delivery';
  let start=typeof site.stageStartedAt==='string'?{at:Date.parse(site.stageStartedAt),precise:true}:typeof site.receivedAt==='string'?{at:Date.parse(site.receivedAt),precise:true}:null;
  if(site.stage==='awaiting'){
   if(site.dispatchDate)add('planned-dispatch','Dispatch date passed',dayEnd(site.dispatchDate),'Estimated dispatch date');
   start=site.planSavedAt?{at:Date.parse(site.planSavedAt),precise:true}:start;
  }else if(site.stage==='delivered'){
   const type=qcType(site);
   if(type==='ups'){key='ups:job';label='UPS job completion';start=stamp({recordedAt:site.deliveryRecordedAt,date:site.deliveryDate});}
   else{const stages=qcStagesFor(site),index=stages.findIndex(s=>!site.qc?.[s.id]);if(index>=0){key=`${type==='bess'?'bess':'solar'}:${stages[index].id}`;label=stages[index].label;start=index?stamp(site.qc?.[stages[index-1].id]):stamp({recordedAt:site.deliveryRecordedAt,date:site.deliveryDate});}}
  }
  const target=values[key as typeof targetStageIds[number]];
  if(start&&target)add(key,label,start.at+target.amount*(target.unit==='days'?86400000:3600000),start.precise?'Moaz stage target':'Moaz stage target · date only; latest possible start used');
 }
 for(const doc of site.documents??[]){
  if(['Received at Karachi office','Submitted to Accounts'].includes(doc.location)||doc.submittedToAccounts===true||doc.submittedToAccountsAt)continue;
  const start=stamp({date:doc.createdDate??doc.date,recordedAt:typeof doc.createdAt==='string'?doc.createdAt:undefined}),target=values.documents;
  if(start&&target)add(`document:${doc.id}`,`${doc.label} · originals pending`,start.at+target.amount*(target.unit==='days'?86400000:3600000),'Original document dispatch target');
 }
 for(const batch of site.planningBatches){const stop=batch.stops.find(s=>s.siteId===site.id);if(!stop)continue;const kind=stop.kind??batch.kind;const pending=kind==='delivery'?['received','awaiting'].includes(site.stage):siteBucket(site)!=='completed';if(pending)add(`batch:${batch.id}`,`${batch.number??batch.id} · ${kind} visit date passed`,stop.end?Date.parse(`${stop.plannedDate}T${stop.end}:00+05:00`):dayEnd(stop.plannedDate),'Saved batch schedule');}
 return delays;
}
/** A blocker enriches the overdue site's existing case instead of adding another card. */
export function activeSiteAlerts(sites:WorkflowSite[],targets:StageTargets,now:string){return sites.flatMap(site=>{
 if(finishedAndSubmitted(site))return [];
 const blockers=site.blockers.filter(b=>b.status==='open'),delays=siteDelays(site,targets,now);
 return blockers.length||delays.length?[{id:site.id,site:site.name,ipo:site.ipo,operationsTeam:site.operationsTeam,blockers,delays}]:[];
});}
