import type {PoolClient} from 'pg';
import {operationsNotificationStart} from '../../shared/operations-notification-policy.js';
/** Event handoffs only. Delay/blocker delivery is handled separately by OperationsIncidentProjector. */
const handoffKinds=['Operations team assigned','Dispatch plan','Batch plan','Partial delivery update','Delivery invoice due','Delivery update','Installation completed','QC stage completed','Existing site evidence recorded','Documents submitted','Saved site decision changed','Document movement corrected','Batch plan changed'];
const corrections=new Set(['Saved site decision changed','Document movement corrected','Batch plan changed']);
export class OperationsNotificationProjector{
 /** Call inside the notification sync transaction. Never starts workers or contacts a provider. */
 async sync(c:PoolClient,clock:string){
  if(!operationsNotificationStart({recordedAt:clock}))throw new Error('An explicit valid projection clock is required.');
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('operations.notification.projection',0))");
  const policy=(await c.query(`SELECT p.* FROM operations_notification_policy_current p JOIN users u ON u.id=p.reviewed_by AND u.active AND u.role IN('Admin','Management') WHERE p.enabled AND p.activated_at<=$1`,[clock])).rows[0];
  if(!policy)return {enabled:false,created:0,heldBlockerEvents:0};
  const rows=(await c.query(`SELECT DISTINCT ON(e.created_at,e.id,r.user_id) e.id,e.site_id,e.kind,e.created_at,e.created_by,r.audience,r.user_id,r.version AS route_version,source.snapshot
   FROM operations_board_events e
   JOIN operations_board_versions source ON source.site_id=e.site_id AND source.version=e.site_version
   JOIN LATERAL(SELECT snapshot FROM operations_board_versions WHERE site_id=e.site_id ORDER BY version DESC LIMIT 1) current_site ON true
   JOIN operations_notification_routes_current r ON r.active AND e.audiences ? r.audience
   JOIN users reviewer ON reviewer.id=r.reviewed_by AND reviewer.active AND reviewer.role IN('Admin','Management')
   JOIN users u ON u.id=r.user_id AND u.active
   LEFT JOIN operations_board_access a ON a.user_id=u.id
   WHERE e.created_at>=$1 AND e.created_at<=$2 AND e.kind=ANY($3::text[])
   AND NOT EXISTS(SELECT 1 FROM operations_notification_intents i WHERE i.event_id=e.id AND i.user_id=r.user_id)
   AND ((r.audience='management' AND u.role IN('Admin','Management')) OR (r.audience='accounts' AND u.role='Accounts')
    OR (r.audience='operations-head' AND u.role='Operations' AND a.kind='head')
    OR (r.audience='central-operations' AND u.role='Operations' AND a.kind='lead' AND a.team='central' AND source.snapshot->>'operationsTeam'='central' AND current_site.snapshot->>'operationsTeam'='central')
    OR (r.audience='central-qc' AND u.role='Operations' AND a.kind='qc' AND a.team='central' AND source.snapshot->>'operationsTeam'='central' AND current_site.snapshot->>'operationsTeam'='central')
    OR (r.audience='south-qc' AND u.role='Operations' AND a.kind='qc' AND a.team='south' AND source.snapshot->>'operationsTeam'='south' AND current_site.snapshot->>'operationsTeam'='south')
    OR (r.audience='south-operations' AND u.role='Operations' AND a.kind='lead' AND a.team='south' AND source.snapshot->>'operationsTeam'='south' AND current_site.snapshot->>'operationsTeam'='south'))
   ORDER BY e.created_at,e.id,r.user_id,r.audience LIMIT 250`,[policy.activated_at,clock,handoffKinds])).rows;
  let created=0;
  for(const row of rows){
   const target=row.audience==='accounts'?{target:'finance',siteId:row.site_id}:{path:'/operations/sites/'+encodeURIComponent(row.site_id)};
   const reference=[row.snapshot.ipo,row.snapshot.name].filter(v=>typeof v==='string').join(' | ').slice(0,500)||'Operations site';
   const result=await c.query(`INSERT INTO operations_notification_intents(event_id,user_id,audience,route_version,policy_version,reference,target,kind,created_at,projected_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(event_id,user_id) DO NOTHING`,[row.id,row.user_id,row.audience,row.route_version,policy.version,reference,target,corrections.has(row.kind)?'Operations correction':'Operations handoff',row.created_at,clock]);
   created+=result.rowCount??0;
  }
  const held=(await c.query("SELECT count(*)::integer AS n FROM operations_board_events WHERE created_at>=$1 AND created_at<=$2 AND kind IN('Site blocker raised','Site blocker resolved')",[policy.activated_at,clock])).rows[0].n;
  return {enabled:true,created,heldBlockerEvents:held as number};
 }
}
/** Call before reading/sending an Operations notice; current routes/role/team are authoritative. */
export async function operationsNotificationRecipientAllowed(c:PoolClient,sourceKey:string,userId:string){
 const match=/^operations-notice:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(sourceKey);if(!match)return false;
 return !!(await c.query('SELECT 1 FROM operations_notification_eligible_intents WHERE id=$1 AND user_id=$2 UNION ALL SELECT 1 FROM operations_notification_eligible_incident_intents WHERE id=$1 AND user_id=$2',[match[1],userId])).rowCount;
}
