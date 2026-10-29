import {solarStages,bessStages} from '../../shared/operations-stages.js';
export {solarStages,bessStages} from '../../shared/operations-stages.js';
import {z} from 'zod';
import {sourceSiteSchema} from './schema.js';
import {HttpError} from '../http/errors.js';
export const fileReferenceSchema=z.object({id:z.uuid(),name:z.string(),mediaType:z.string()});
const history=z.array(z.object({date:z.string(),description:z.string()}).passthrough());
const entry=z.object({date:z.iso.date(),evidence:fileReferenceSchema.optional(),additionalEvidence:z.array(fileReferenceSchema).optional(),acknowledgement:fileReferenceSchema.optional(),irr:fileReferenceSchema.optional(),variableSignoff:fileReferenceSchema.optional(),recordedAt:z.string().optional()}).passthrough();
const delivery=z.object({deliveryDate:z.iso.date(),signedDo:fileReferenceSchema,materialPhoto:fileReferenceSchema,partial:z.boolean(),documentId:z.string().optional()});
const storedWorkflowSiteSchema=sourceSiteSchema.and(z.object({
 dispatchDate:z.iso.date().optional(),installationPlanDate:z.iso.date().optional(),planSavedAt:z.string().optional(),deliveryDate:z.iso.date().optional(),deliveryRecordedAt:z.string().optional(),stageStartedAt:z.string().optional(),
 assignments:z.record(z.string(),z.string()).optional(),teamMembers:z.array(z.object({id:z.uuid(),name:z.string()})).optional(),qc:z.record(z.string(),entry).optional(),qcJob:entry.optional(),
 planningBatches:z.array(z.object({id:z.string(),number:z.string().optional(),kind:z.enum(['delivery','labour','both']),stops:z.array(z.object({siteId:z.string(),kind:z.enum(['delivery','labour','both']).optional(),plannedDate:z.iso.date(),start:z.string(),end:z.string()}).passthrough())}).passthrough()).default([]),
 deliveryReturns:z.array(z.object({scope:z.enum(['full','partial']),date:z.iso.date().nullable(),dateUnknown:z.boolean(),warehouse:z.string(),reference:z.string(),reason:z.string(),recordedAt:z.string()}).passthrough()).default([]),
 deliveries:z.array(delivery).optional(),history:history.default([]),accounts:z.array(z.record(z.string(),z.unknown())).default([]),
 blockers:z.array(z.object({id:z.string(),reason:z.string(),stage:z.string(),status:z.enum(['open','resolved']),raisedAt:z.string(),raisedBy:z.string(),actorId:z.string(),resolution:z.string().optional(),resolvedAt:z.string().optional(),resolvedBy:z.string().optional()}).passthrough()).default([]),
}).passthrough());
/** Imported registers encode an unknown date as an empty cell. Treat only
 * that legacy representation as absent; never guess or accept malformed dates. */
export const workflowSiteSchema=z.preprocess(value=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return value;
 const normalized={...value} as Record<string,unknown>;
 for(const field of ['dispatchDate','deliveryDate'])if(normalized[field]==='')delete normalized[field];
 return normalized;
},storedWorkflowSiteSchema);
export type WorkflowSite=z.infer<typeof workflowSiteSchema>;
export type FileReference=z.infer<typeof fileReferenceSchema>;
export type Entry=z.infer<typeof entry>;
export type Delivery=z.infer<typeof delivery>;
export type Planning={dispatchDate:string;assignments:Record<string,string>;teamMembers?:{id:string;name:string}[]};
export const qcType=(site:WorkflowSite)=>site.projectType??(/solar/i.test(String(site.type??''))?'solar-bess':/ups/i.test(String(site.type??''))?'ups':'bess');
export const qcStagesFor=(site:WorkflowSite)=>qcType(site)==='bess'?bessStages:solarStages;
export const siteBucket=(site:WorkflowSite)=>site.completed||site.qc?.signoff||site.qc?.handover||site.stage==='delivered'&&site.installation===false?'completed':site.stage;
export const today=(now:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
function event(site:WorkflowSite,now:string,description:string){return [...site.history,{date:now,description}];}
function validCompletionDate(date:string,previous:string|undefined,now:string){if(date>today(now)||previous&&date<previous)throw new HttpError(422,'Enter a date on or after the previous stage and not in the future.');}
export function saveDispatchPlan(site:WorkflowSite,plan:Planning,now:string,editing=false):WorkflowSite{
 if(editing&&!site.dispatchDate)throw new HttpError(409,'There is no saved dispatch plan to edit.');
 if(site.dispatchDate&&!editing)throw new HttpError(409,'The saved dispatch plan is locked. Use Edit and give a reason.');
 if(site.completed&&!editing||site.stage==='delivered'&&!editing)throw new HttpError(409,'This site is already delivered.');
 if(site.scopePending||site.installation===null)throw new HttpError(422,'Verify the approved delivery and installation scope before planning dispatch.');
 if(!site.operationsTeam)throw new HttpError(422,'Moaz needs to assign the Operations team first.');
 const required=site.installation?qcType(site)==='ups'?['electrical','delivery']:['structure','electrical','earthing','delivery']:['delivery'];
 if(required.some(role=>!plan.assignments[role]?.trim()))throw new HttpError(422,'Complete the applicable vendor assignments, including Delivery.');
 const accountsEvent={id:`${site.id}:dispatch-plan`,type:'Dispatch plan',date:now,ipo:site.ipo,site:site.name,dispatchDate:plan.dispatchDate,description:'IPO and estimated dispatch date ready for Accounts'};
 return {...site,...plan,stage:editing?site.stage:'awaiting',planSavedAt:site.planSavedAt??now,stageStartedAt:site.stage==='received'?now:site.stageStartedAt,accounts:[...site.accounts.filter(e=>e.id!==accountsEvent.id),accountsEvent],history:event(site,now,`Dispatch estimated for ${plan.dispatchDate}. Accounts handoff updated.`)};
}
export function confirmDelivery(site:WorkflowSite,value:Delivery,now:string):WorkflowSite{
 if(site.stage!=='awaiting')throw new HttpError(409,'Save the dispatch plan before confirming delivery.');
 validCompletionDate(value.deliveryDate,site.deliveries?.at(-1)?.deliveryDate,now);
 const number=(site.deliveries?.length??0)+1,documentId=`${site.id}:delivery-document:${number}`,savedDelivery={...value,documentId};
 const partial=value.partial,accountsEvent={id:`${site.id}:delivery:${number}`,documentId,type:partial?'Partial delivery update':site.invoiceOnDelivery?'Delivery invoice due':'Delivery update',date:now,ipo:site.ipo,site:site.name,deliveryDate:value.deliveryDate,description:partial?'Part delivered; remaining material pending':site.invoiceOnDelivery?'Delivery completed; ready for Accounts to invoice':'Delivery completed; no delivery invoice milestone',evidence:[value.signedDo.id,value.materialPhoto.id]};
 const document={id:documentId,label:partial?'Partial delivery DO':site.deliveries?.length?'Final delivery DO':'Delivery DO',location:'At site' as const,date:value.deliveryDate,createdDate:value.deliveryDate,createdAt:now,evidence:[value.signedDo],history:[]};
 return {...site,...value,deliveryRecordedAt:now,stageStartedAt:partial?site.stageStartedAt:now,stage:partial?'awaiting':'delivered',completed:!partial&&site.installation===false,deliveries:[...(site.deliveries??[]),savedDelivery],documents:[...(site.documents??[]),document],accounts:[...site.accounts.filter(e=>e.id!==accountsEvent.id),accountsEvent],history:event(site,now,`${partial?'Partial delivery':'Delivery'} confirmed for ${value.deliveryDate}.`)};
}
function complete(site:WorkflowSite,value:Entry,now:string):WorkflowSite{
 if(!value.acknowledgement||!value.irr||!value.variableSignoff)throw new HttpError(422,'Upload the acknowledgement, IRR and variable-items sign-off.');
 const accountsEvent={id:`${site.id}:installation-complete`,type:'Installation completed',date:now,ipo:site.ipo,site:site.name,description:'Installation completed; customer sign-offs recorded; ready for Accounts review'};
 const document={id:`${site.id}:completion-documents`,label:'Acknowledgement, IRR & variable sign-off',location:'At site' as const,date:value.date,createdDate:value.date,createdAt:now,evidence:[value.acknowledgement,value.irr,value.variableSignoff],history:[]};
 const old=site.documents?.find(d=>d.id===document.id);
 return {...site,completed:true,accounts:[...site.accounts.filter(e=>e.id!==accountsEvent.id),accountsEvent],documents:[...(site.documents??[]).filter(d=>d.id!==document.id),old?{...document,...old,evidence:document.evidence}:document]};
}
export function completeQcStage(site:WorkflowSite,stageId:string,value:Entry,now:string,editing=false):WorkflowSite{
 if(!site.installation||!(site.stage==='delivered'||site.stage==='awaiting'&&site.deliveries?.length))throw new HttpError(409,'QC updates require a recorded delivery for installation sites.');
 if(qcType(site)==='ups')throw new HttpError(422,'UPS is completed as one job with a single date.');
 const stages=qcStagesFor(site),index=stages.findIndex(s=>s.id===stageId);
 if(index<0)throw new HttpError(422,'Choose an applicable QC stage.');
 if(index===stages.length-1&&site.stage!=='delivered')throw new HttpError(409,'Record the remaining delivery before final customer handover.');
 if(editing&&!site.qc?.[stageId])throw new HttpError(409,'There is no saved QC stage to edit.');
 if(site.qc?.[stageId]&&!editing)throw new HttpError(409,'This QC stage is locked. Use Edit and give a reason.');
 if(stages.slice(0,index).some(s=>!site.qc?.[s.id]))throw new HttpError(422,'Complete the earlier QC stages first.');
 validCompletionDate(value.date,index?site.qc?.[stages[index-1].id]?.date:site.deliveryDate,now);
 if(editing&&site.qc?.[stages[index+1]?.id]?.date&&value.date>site.qc[stages[index+1].id].date)throw new HttpError(422,'The date cannot be later than the next recorded QC stage.');
 if(index!==stages.length-1&&!value.evidence)throw new HttpError(422,'Upload QC evidence before completing this stage.');
 const updated={...site,qc:{...site.qc,[stageId]:{...value,recordedAt:editing?site.qc?.[stageId]?.recordedAt??now:now}},stageStartedAt:editing?site.stageStartedAt:now,history:event(site,now,`${stages[index].label} completed on ${value.date}.`)};
 return index===stages.length-1?complete(updated,value,now):updated;
}
export function completeUpsJob(site:WorkflowSite,value:Entry&{checks:Record<string,boolean>},now:string,editing=false):WorkflowSite{
 if(qcType(site)!=='ups'||!site.installation||site.stage!=='delivered')throw new HttpError(409,'UPS completion is available after delivery for UPS installation jobs.');
 if(editing&&!site.qcJob)throw new HttpError(409,'There is no saved UPS job to edit.');
 if(site.qcJob&&!editing)throw new HttpError(409,'This UPS job is locked. Use Edit and give a reason.');
 validCompletionDate(value.date,site.deliveryDate,now);
 if(['mounting','electrical','testingTraining','signoff'].some(key=>value.checks[key]!==true))throw new HttpError(422,'Confirm system mounting, electrical work, testing/training and customer sign-off.');
 if(!value.evidence)throw new HttpError(422,'Upload the job QC evidence.');
 return complete({...site,qcJob:{...value,recordedAt:editing?site.qcJob?.recordedAt??now:now},history:event(site,now,`UPS completed as one job on ${value.date}.`)},value,now);
}
export function currentStage(site:WorkflowSite){return siteBucket(site)==='completed'?'Completed / physical documents':site.stage==='received'?'Team assignment & dispatch planning':site.stage==='awaiting'?'Awaiting delivery':qcType(site)==='ups'?'UPS job completion':qcStagesFor(site).find(s=>!site.qc?.[s.id])?.label??'Customer sign-off';}
