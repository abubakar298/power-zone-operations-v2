import type {PoolClient} from 'pg';
/**
 * IPO planning alerts: once a site reaches the Operations board ("Team & vendor assignment"),
 * Solar sites only (solar, solar + BESS); UPS, BESS-only and delivery-only sites get no alert.
 * Operations must plan it within 48 working hours (Monday to Friday, Pakistan time).
 * After that, the Operations heads and the site's team leads get a "Planning pending"
 * alert, repeated every 12 working hours until the site is planned.
 */
const HOUR=3600000,DAY=24*HOUR,PKT=5*HOUR;
export const SOLAR_TYPES=['solar','solar-bess'];
export const PLANNING_DEADLINE_HOURS=48,PLANNING_REMINDER_EVERY_HOURS=12;
const weekend=(local:number)=>{const day=new Date(local).getUTCDay();return day===0||day===6;};
/** Working (Mon–Fri, PKT) milliseconds between two instants. */
export function workingMsBetween(from:number,to:number):number{
 if(!(to>from))return 0;
 let total=0,local=from+PKT;const end=to+PKT;
 while(local<end){const next=Math.min(end,Math.floor(local/DAY)*DAY+DAY);if(!weekend(local))total+=next-local;local=next;}
 return total;
}
/** The instant reached after adding working (Mon–Fri, PKT) milliseconds. */
export function addWorkingMs(from:number,ms:number):number{
 let local=from+PKT,left=ms;
 for(;;){
  if(weekend(local)){local=Math.floor(local/DAY)*DAY+DAY;continue;}
  const dayEnd=Math.floor(local/DAY)*DAY+DAY;
  if(dayEnd-local>=left)return local+left-PKT;
  left-=dayEnd-local;local=dayEnd;
 }
}
/** The latest reminder that is due now, or null while still inside the 48 working hours. */
export function planningReminder(startedAt:number,now:number){
 const elapsed=workingMsBetween(startedAt,now);
 if(elapsed<PLANNING_DEADLINE_HOURS*HOUR)return null;
 const sequence=Math.floor((elapsed-PLANNING_DEADLINE_HOURS*HOUR)/(PLANNING_REMINDER_EVERY_HOURS*HOUR));
 return {sequence,deadline:new Date(addWorkingMs(startedAt,PLANNING_DEADLINE_HOURS*HOUR)).toISOString(),dueAt:new Date(addWorkingMs(startedAt,(PLANNING_DEADLINE_HOURS+sequence*PLANNING_REMINDER_EVERY_HOURS)*HOUR)).toISOString()};
}
const pkt=(iso:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Karachi',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}).format(new Date(iso));
export class PlanningReminderProjector{
 async sync(c:PoolClient,clock:string){
  const now=Date.parse(clock);
  const activation=(await c.query('SELECT activated_at FROM operations_planning_reminder_settings')).rows[0]?.activated_at;
  if(!activation)return;
  const activatedAt=new Date(activation).getTime();
  const sites=(await c.query(`SELECT site_id,snapshot FROM (SELECT DISTINCT ON(site_id) site_id,snapshot FROM operations_board_versions ORDER BY site_id,version DESC) v WHERE snapshot->>'stage'='received'`)).rows;
  for(const {site_id,snapshot:s} of sites){
   if(!SOLAR_TYPES.includes(s.projectType)||s.dispatchDate||(Array.isArray(s.planningBatches)&&s.planningBatches.length)||s.completed===true)continue;
   const startedKey=typeof s.stageStartedAt==='string'?s.stageStartedAt:typeof s.receivedAt==='string'?s.receivedAt:null;
   const started=startedKey?Date.parse(startedKey):NaN;
   if(!startedKey||!Number.isFinite(started))continue;
   // Sites already waiting when this alert went live get the full 48 working hours from then.
   const due=planningReminder(Math.max(started,activatedAt),now);
   if(!due)continue;
   const reference=[s.ipo,s.name].filter((v:unknown)=>typeof v==='string'&&v.trim()).join(' | ')+' · Planning was due '+pkt(due.deadline);
   await c.query(`INSERT INTO operations_planning_reminders(id,site_id,started_key,sequence,due_at,reference) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [`${site_id}:${startedKey}:${due.sequence}`,site_id,startedKey,due.sequence,due.dueAt,reference]);
  }
  // Each reminder lands in the bell once per person; it clears itself when the site is planned.
  await c.query(`INSERT INTO notifications(id,user_id,source_key,entity_key,kind,title,reference,actor_id,target,actionable,created_at)
   SELECT gen_random_uuid(),e.owner_id,e.source_key,e.entity_key,e.kind,e.kind,e.reference,NULL,e.target,false,e.created_at
   FROM operations_planning_reminder_events e ON CONFLICT(user_id,source_key) DO NOTHING`);
  await c.query(`UPDATE notifications n SET resolved_at=now() WHERE n.source_key LIKE 'planning-reminder:%' AND n.resolved_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM operations_planning_reminder_events e WHERE e.source_key=n.source_key)`);
 }
}
