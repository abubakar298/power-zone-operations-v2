/** Pure policy. Callers own current authorization, durable reservations and delivery. */
export type OperationsTier='assigned'|'lead'|'management';
export type OperationsNotificationReceipt={incidentId:string;recipientId:string};
export type OperationsNotificationInput={
 siteId:string;stageKey:string;
 /** Immutable stage-entry identity, never current snapshot/target version. */
 occurrenceKey:string;now:string;
 start?:{recordedAt?:string|null;date?:string|null}|null;
 target?:{amount:number;unit:'hours'|'days'}|null;
 completed:boolean;documentsSubmittedToAccounts:boolean;
 /** Reviewed explicit user IDs. No recipients are discovered here. */
 recipients:Partial<Record<OperationsTier,string|null>>;
 openBlockerIds?:readonly string[];
 /** Include queued/reserved and accepted records; retries belong to that same outbox. */
 receipts?:readonly OperationsNotificationReceipt[];
};
export type OperationsNotificationDecision={
 incidentId:string|null;suppressed:boolean;basis:'recorded-time'|'date-only'|null;deadline:string|null;blockerIds:string[];holds:string[];
 eligible:{key:string;incidentId:string;recipientId:string;tier:OperationsTier;trigger:'delay'|'blocker';dueAt:string}[];
};
const tiers:OperationsTier[]=['assigned','lead','management'];
const nonblank=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
/** Explicit timezone required; impossible dates must not normalize into another day. */
function timestamp(value:unknown):number|null{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
 const date=value.slice(0,10),day=Date.parse(date+'T00:00:00Z');
 if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==date)return null;
 const clock=value.slice(11,19).split(':').map(Number);
 if(clock[0]>23||clock[1]>59||clock[2]>59)return null;
 const offset=value.match(/([+-])(\d{2}):(\d{2})$/);
 if(offset&&(Number(offset[2])>23||Number(offset[3])>59))return null;
 const at=Date.parse(value);return Number.isFinite(at)?at:null;
}
/** Same conservative Pakistan day-end convention as Operations stage delays. */
export function operationsNotificationStart(start:OperationsNotificationInput['start']):{at:number;basis:'recorded-time'|'date-only'}|null{
 if(start?.recordedAt!=null){const at=timestamp(start.recordedAt);return at===null?null:{at,basis:'recorded-time'};}
 if(typeof start?.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(start.date))return null;
 const at=timestamp(start.date+'T23:59:59+05:00');return at===null?null:{at,basis:'date-only'};
}
export function operationsIncidentId(siteId:string,stageKey:string,occurrenceKey:string):string|null{
 if(![siteId,stageKey,occurrenceKey].every(nonblank))return null;
 return 'operations-incident:'+JSON.stringify([siteId,stageKey,occurrenceKey]);
}
export function operationsNotificationPolicy(input:OperationsNotificationInput):OperationsNotificationDecision{
 const incidentId=operationsIncidentId(input.siteId,input.stageKey,input.occurrenceKey);
 const blockerIds=[...new Set((input.openBlockerIds??[]).filter(nonblank))].sort();
 const result:OperationsNotificationDecision={incidentId,suppressed:input.completed&&input.documentsSubmittedToAccounts,basis:null,deadline:null,blockerIds,holds:[],eligible:[]};
 if(result.suppressed)return result;
 if(!incidentId){result.holds.push('Stage occurrence identity is missing.');return result;}
 const now=timestamp(input.now);if(now===null){result.holds.push('Current time is missing or invalid.');return result;}
 const start=operationsNotificationStart(input.start),target=input.target;
 const period=target&&Number.isFinite(target.amount)&&target.amount>0&&['hours','days'].includes(target.unit)?target.amount*(target.unit==='days'?86400000:3600000):null;
 let deadline:number|null=null;
 if(!start)result.holds.push('Stage start is missing or invalid.');
 else if(start.at>now)result.holds.push('Stage start is in the future.');
 else if(period===null||!Number.isFinite(period)||period<=0)result.holds.push('Stage target is missing or invalid.');
 else if(!Number.isFinite(start.at+period*3)||Math.abs(start.at+period*3)>8640000000000000)result.holds.push('Stage deadline is outside the supported range.');
 else{deadline=start.at+period;result.deadline=new Date(deadline).toISOString();result.basis=start.basis;}
 const reserved=new Set((input.receipts??[]).filter(r=>r.incidentId===incidentId).map(r=>r.recipientId));
 for(const [index,tier]of tiers.entries()){
  const recipientId=input.recipients[tier];
  if(!nonblank(recipientId)){result.holds.push(`Reviewed ${tier} recipient is missing.`);continue;}
  const tierDue=deadline===null||period===null?null:deadline+period*index;
  // Blockers can alert immediately without inventing a missing stage clock.
  if(!blockerIds.length&&(tierDue===null||now<tierDue))continue;
  if(reserved.has(recipientId))continue;
  reserved.add(recipientId);
  result.eligible.push({key:'operations-recipient:'+JSON.stringify([incidentId,recipientId]),incidentId,recipientId,tier,trigger:blockerIds.length?'blocker':'delay',dueAt:new Date(blockerIds.length?now:tierDue!).toISOString()});
 }
 return result;
}
