import type {Pool} from 'pg';
import {transaction} from '../db/transaction.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {HttpError} from '../http/errors.js';
import {z} from 'zod';
const activationSchema=z.object({version:z.number().int().nonnegative(),requestKey:z.uuid(),recipients:z.object({accounts:z.array(z.uuid()).min(1),inventory:z.array(z.uuid()).min(1),leads:z.array(z.uuid()).min(1),qc:z.array(z.uuid()).min(1),management:z.array(z.uuid()).min(1)}).strict(),reason:z.string().trim().min(3).max(2000)}).strict();
/** Operator-only activation; never exposed as a public HTTP endpoint or run at application startup. */
export async function activateWorkflowHandoffs(pool:Pool,actor:string,input:z.infer<typeof activationSchema>){
 const value=activationSchema.parse(input);
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);const reviewer=(await c.query("SELECT id FROM users WHERE id=$1 AND active AND role IN('Admin','Management')",[actor])).rows[0];if(!reviewer)throw new HttpError(403,'Management review required.');
  await c.query("SELECT pg_advisory_xact_lock(hashtext('workflow.handoff.activation'))");
  const replay=(await c.query('SELECT * FROM workflow_handoff_policy_versions WHERE request_key=$1',[value.requestKey])).rows[0];
  const recipients=Object.fromEntries(Object.entries(value.recipients).map(([group,ids])=>[group,[...new Set(ids)].sort()]));
  if(replay){if(replay.reviewed_by!==actor||!Object.keys(recipients).every(group=>JSON.stringify(replay.recipients[group])===JSON.stringify(recipients[group]))||replay.reason!==value.reason)throw new HttpError(409,'Activation request already used.');return replay;}
  const prior=(await c.query('SELECT version FROM workflow_handoff_policy_current')).rows[0];if((prior?.version??0)!==value.version)throw new HttpError(409,'Notification policy changed; review before activating.');
  for(const [group,ids] of Object.entries(recipients))for(const id of ids){
   const u=(await c.query(`SELECT u.role,a.kind,a.team,q.granted_by FROM users u LEFT JOIN operations_board_access a ON a.user_id=u.id LEFT JOIN operations_board_qc_delegations q ON q.user_id=u.id AND q.team=a.team AND q.revoked_at IS NULL AND (q.expires_at IS NULL OR q.expires_at>now()) AND EXISTS(SELECT 1 FROM users g WHERE g.id=q.granted_by AND g.active AND g.role IN('Admin','Management')) WHERE u.id=$1 AND u.active`,[id])).rows[0];
   const allowed=group==='accounts'?u?.role==='Accounts':group==='inventory'?u?.role==='Inventory'&&(await c.query("SELECT 1 FROM inventory_material_access WHERE user_id=$1 AND capability='dispatcher'",[id])).rowCount:group==='management'?['Admin','Management'].includes(u?.role):group==='leads'?u?.role==='Operations'&&u.kind==='lead'&&['central','south'].includes(u.team):u?.role==='Operations'&&['central','south'].includes(u.team)&&(u.kind==='qc'||u.kind==='lead'&&u.granted_by);
   if(!allowed)throw new HttpError(422,'A selected recipient does not have the required current departmental access.');
  }
  const row=(await c.query('INSERT INTO workflow_handoff_policy_versions(version,enabled,activated_at,reviewed_by,recipients,reason,request_key) VALUES($1,true,clock_timestamp(),$2,$3,$4,$5) RETURNING *',[value.version+1,actor,recipients,value.reason,value.requestKey])).rows[0];
  await c.query('INSERT INTO notification_admin_audit(user_id,action) VALUES($1,$2)',[actor,'workflow.handoff.activated:'+row.version]);return row;
 });
}
