import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {operationsIncidentId,operationsNotificationPolicy,operationsNotificationStart,type OperationsNotificationInput} from '../../shared/operations-notification-policy.js';
import {workflowSiteSchema,qcType,qcStagesFor,siteBucket,currentStage,type WorkflowSite} from '../operations-board/workflow.js';
type Stage={key:string;label:string;start:OperationsNotificationInput['start']};
const text=(v:unknown)=>typeof v==='string'?v:undefined;
function stage(site:WorkflowSite):Stage{
 if(siteBucket(site)==='completed')return {key:'documents',label:'Physical documents',start:null};
 if(site.stage==='received')return {key:'received',label:'Team & vendor assignment',start:{recordedAt:site.stageStartedAt??text(site.receivedAt)}};
 if(site.stage==='awaiting')return {key:'awaiting',label:'Awaiting delivery',start:{recordedAt:site.planSavedAt??site.stageStartedAt??text(site.receivedAt)}};
 if(qcType(site)==='ups')return {key:'ups:job',label:'UPS job completion',start:{recordedAt:site.deliveryRecordedAt,date:site.deliveryDate}};
 const stages=qcStagesFor(site),index=stages.findIndex(s=>!site.qc?.[s.id]),next=stages[index];
 if(!next)return {key:'documents',label:'Physical documents',start:null};
 const previous=index?site.qc?.[stages[index-1].id]:null;
 return {key:`${qcType(site)==='bess'?'bess':'solar'}:${next.id}`,label:next.label,start:previous?{recordedAt:previous.recordedAt,date:previous.date}:{recordedAt:site.deliveryRecordedAt,date:site.deliveryDate}};
}
function submitted(site:WorkflowSite){return site.documentsSubmittedToAccounts===true||!!site.documentsSubmittedToAccountsAt||!!site.documents?.length&&site.documents.every(d=>d.location==='Submitted to Accounts'||d.submittedToAccounts===true||!!d.submittedToAccountsAt);}
/** Current-stage delays and same-stage blockers. Physical-document/batch deadlines remain explicitly held. */
export class OperationsIncidentProjector{
 async sync(c:PoolClient,clock:string){
  const parsedNow=operationsNotificationStart({recordedAt:clock});if(!parsedNow)throw new Error('An explicit valid incident clock is required.');
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('operations.notification.incidents',0))");
  const policy=(await c.query(`SELECT p.* FROM operations_notification_policy_current p JOIN users u ON u.id=p.reviewed_by AND u.active AND u.role IN('Admin','Management') WHERE p.enabled AND p.activated_at<=$1`,[clock])).rows[0];
  if(!policy)return {enabled:false,created:0,evaluated:0,held:[] as {siteId:string;reasons:string[]}[]};
  const target=(await c.query('SELECT version,values FROM operations_board_target_versions ORDER BY version DESC LIMIT 1')).rows[0];
  const routes=(await c.query(`SELECT r.*,u.role,a.kind,a.team FROM operations_notification_routes_current r
   JOIN users u ON u.id=r.user_id AND u.active JOIN users reviewer ON reviewer.id=r.reviewed_by AND reviewer.active AND reviewer.role IN('Admin','Management')
   LEFT JOIN operations_board_access a ON a.user_id=u.id WHERE r.active`)).rows;
  const cursor=(await c.query('SELECT after_site_id FROM operations_notification_scan_cursor WHERE singleton FOR UPDATE')).rows[0];
  if(!cursor)throw new Error('Operations notification scan cursor is missing.');
  const scan=`SELECT v.site_id,v.version,v.snapshot,s.incident_id,s.stage_key,s.occurrence_version,s.site_version,s.facts_sha256,observation.facts AS previous_facts FROM
   (SELECT DISTINCT ON(site_id) site_id,version,snapshot FROM operations_board_versions ORDER BY site_id,version DESC) v
   LEFT JOIN operations_notification_incident_state s ON s.site_id=v.site_id
   LEFT JOIN operations_notification_incident_observations observation ON observation.incident_id=s.incident_id AND observation.facts_sha256=s.facts_sha256`;
  const latest=(await c.query(scan+' WHERE ($1::text IS NULL OR v.site_id>$1) ORDER BY v.site_id LIMIT 250',[cursor.after_site_id])).rows;
  if(cursor.after_site_id!==null&&latest.length<250)latest.push(...(await c.query(scan+' WHERE v.site_id<=$1 ORDER BY v.site_id LIMIT $2',[cursor.after_site_id,250-latest.length])).rows);
  let created=0;const held:{siteId:string;reasons:string[]}[]=[];
  for(const row of latest){
   const parsed=workflowSiteSchema.safeParse(row.snapshot);if(!parsed.success){
    const reasons=['Site workflow data needs review.'];
    // Scan fairness belongs to the keyset cursor, not per-site writes.
    // Retain one held state per source version; never manufacture an incident.
    const hash=createHash('sha256').update(JSON.stringify({siteVersion:row.version,holds:reasons})).digest('hex');
    if(row.site_version!==row.version||row.facts_sha256!==hash||row.incident_id!==null)await c.query(`INSERT INTO operations_notification_incident_state(site_id,incident_id,stage_key,occurrence_version,site_version,team,eligible_recipients,active,facts_sha256,as_of) VALUES($1,NULL,NULL,NULL,$2,NULL,'{}',false,$3,$4)
     ON CONFLICT(site_id) DO UPDATE SET incident_id=NULL,stage_key=NULL,occurrence_version=NULL,site_version=EXCLUDED.site_version,team=NULL,eligible_recipients='{}',active=false,facts_sha256=EXCLUDED.facts_sha256,as_of=EXCLUDED.as_of`,[row.site_id,row.version,hash,clock]);
    held.push({siteId:row.site_id,reasons});continue;
   }
   const site=parsed.data,current=stage(site);let occurrence:number;
   if(row.site_version===row.version&&row.stage_key===current.key)occurrence=row.occurrence_version;
   else{
    const history=(await c.query('SELECT version,snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC',[row.site_id])).rows;
    occurrence=row.version;
    for(const version of history){const old=workflowSiteSchema.safeParse(version.snapshot);if(!old.success||stage(old.data).key!==current.key)break;occurrence=version.version;}
   }
   const occurrenceKey='version:'+occurrence,incidentId=operationsIncidentId(row.site_id,current.key,occurrenceKey)!;
   const reasons:string[]=[];
   const route=(audience:string)=>{
    const valid=routes.filter(r=>r.audience===audience&&(
     audience==='management'&&['Admin','Management'].includes(r.role)||audience==='operations-head'&&r.role==='Operations'&&r.kind==='head'||
     audience===`${site.operationsTeam}-operations`&&r.role==='Operations'&&r.kind==='lead'&&r.team===site.operationsTeam||
     audience===`${site.operationsTeam}-qc`&&r.role==='Operations'&&r.kind==='qc'&&r.team===site.operationsTeam));
    if(valid.length!==1){reasons.push(valid.length?'Reviewed '+audience+' route is ambiguous.':'Reviewed '+audience+' route is missing.');return null;}return valid[0];
   };
   const qc=site.operationsTeam?route(site.operationsTeam+'-qc'):null,lead=site.operationsTeam?route(site.operationsTeam+'-operations'):null,owner=route('management');
   if(!site.operationsTeam)reasons.push('Operations team is not assigned.');
   const open=site.blockers.filter(b=>b.status==='open');
   let blockerOrigins:Record<string,number>=row.previous_facts?.blockerOrigins??{};
   if(open.length&&(row.site_version!==row.version||open.some(b=>!Number.isInteger(blockerOrigins[b.id])))){
    blockerOrigins={};
    const origins=(await c.query(`SELECT blocker.value->>'id' AS id,min(v.version)::integer AS version FROM operations_board_versions v
     CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.snapshot->'blockers')='array' THEN v.snapshot->'blockers' ELSE '[]'::jsonb END) blocker(value)
     WHERE v.site_id=$1 AND blocker.value->>'id'=ANY($2::text[]) GROUP BY blocker.value->>'id'`,[row.site_id,open.map(b=>b.id)])).rows;
    for(const origin of origins)blockerOrigins[origin.id]=origin.version;
   }
   const currentLabel=currentStage(site);
   const currentBlockers=open.filter(b=>b.stage===currentLabel&&Number.isInteger(blockerOrigins[b.id])&&blockerOrigins[b.id]>=occurrence);
   if(currentBlockers.length!==open.length)reasons.push('Open blocker belongs to another stage occurrence; review its disposition.');
   const blockers=currentBlockers.filter(b=>{const raised=operationsNotificationStart({recordedAt:b.raisedAt});return raised&&raised.at>=new Date(policy.activated_at).getTime()&&raised.at<=parsedNow.at;});
   if(currentBlockers.length!==blockers.length)reasons.push('Pre-activation or undated blockers are held from email; local alerts remain.');
   const input:OperationsNotificationInput={siteId:row.site_id,stageKey:current.key,occurrenceKey,now:clock,start:current.start,target:current.key==='documents'?null:target?.values?.[current.key],completed:siteBucket(site)==='completed',documentsSubmittedToAccounts:submitted(site),recipients:{assigned:qc?.user_id,lead:lead?.user_id,management:owner?.user_id},openBlockerIds:blockers.map(b=>b.id)};
   const decision=operationsNotificationPolicy(input);
   if(current.key==='documents'&&!decision.suppressed)reasons.push('Physical-document deadlines require their document-specific occurrence mapping.');
   if(site.planningBatches?.length)reasons.push('Batch-slot email deadlines require their separate occurrence mapping.');
   let eligible=decision.eligible.map(e=>({...e,audience:e.tier==='assigned'?qc!.audience:e.tier==='lead'?lead!.audience:owner!.audience,routeVersion:e.tier==='assigned'?qc!.version:e.tier==='lead'?lead!.version:owner!.version,tier:e.tier as string}));
   // Activation must not replay already-overdue historical stages as new emails.
   if(!blockers.length&&decision.deadline&&new Date(decision.deadline).getTime()<new Date(policy.activated_at).getTime()){
    eligible=[];reasons.push('Stage was already overdue before activation; reviewed catch-up is required.');
   }
   if(blockers.length&&!decision.suppressed){
    const head=route('operations-head');if(head&&!eligible.some(e=>e.recipientId===head.user_id))eligible.push({key:'head:'+incidentId,incidentId,recipientId:head.user_id,tier:'head',trigger:'blocker',dueAt:clock,audience:head.audience,routeVersion:head.version});
   }
   reasons.push(...decision.holds);
   const facts={siteVersion:row.version,targetVersion:target?.version??null,policyVersion:policy.version,stage:current.key,deadline:decision.deadline,blockerIds:open.map(b=>b.id).sort(),blockerOrigins,eligible:eligible.map(e=>e.recipientId).sort(),suppressed:decision.suppressed,holds:[...new Set(reasons)].sort()};
   const hash=createHash('sha256').update(JSON.stringify(facts)).digest('hex');
   if(row.site_version===row.version&&row.incident_id===incidentId&&row.facts_sha256===hash){
    if(reasons.length)held.push({siteId:row.site_id,reasons:[...new Set(reasons)]});
    continue;
   }
   await c.query('INSERT INTO operations_notification_incidents(id,site_id,stage_key,occurrence_version) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[incidentId,row.site_id,current.key,occurrence]);
   await c.query('INSERT INTO operations_notification_incident_observations(incident_id,facts_sha256,facts,observed_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[incidentId,hash,facts,clock]);
   await c.query(`INSERT INTO operations_notification_incident_state(site_id,incident_id,stage_key,occurrence_version,site_version,team,eligible_recipients,active,facts_sha256,as_of) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT(site_id) DO UPDATE SET incident_id=EXCLUDED.incident_id,stage_key=EXCLUDED.stage_key,occurrence_version=EXCLUDED.occurrence_version,site_version=EXCLUDED.site_version,team=EXCLUDED.team,eligible_recipients=EXCLUDED.eligible_recipients,active=EXCLUDED.active,facts_sha256=EXCLUDED.facts_sha256,as_of=EXCLUDED.as_of`,[row.site_id,incidentId,current.key,occurrence,row.version,site.operationsTeam??null,eligible.map(e=>e.recipientId),eligible.length>0,hash,clock]);
   const reference=[site.ipo,site.name,current.label].filter(Boolean).join(' | ').slice(0,500);
   for(const e of eligible){const saved=await c.query(`INSERT INTO operations_notification_incident_intents(incident_id,user_id,audience,route_version,policy_version,trigger,tier,reference,target,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(incident_id,user_id) DO NOTHING`,[incidentId,e.recipientId,e.audience,e.routeVersion,policy.version,e.trigger,e.tier,reference,{path:'/operations/sites/'+encodeURIComponent(row.site_id)},clock]);created+=saved.rowCount??0;}
   if(reasons.length)held.push({siteId:row.site_id,reasons:[...new Set(reasons)]});
  }
  await c.query('UPDATE operations_notification_scan_cursor SET after_site_id=$1,updated_at=$2 WHERE singleton',[latest.at(-1)?.site_id??null,clock]);
  return {enabled:true,created,evaluated:latest.length,held};
 }
}
