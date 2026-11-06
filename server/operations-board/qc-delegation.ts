import type {Pool} from 'pg';
import {transaction} from '../db/transaction.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {HttpError} from '../http/errors.js';
/** Current base role/team is checked on every request; a stale grant cannot follow reassignment. */
export const regionalQcDelegationSql="(a.kind='lead' AND EXISTS(SELECT 1 FROM operations_board_qc_delegations q WHERE q.user_id=u.id AND q.team=a.team AND q.revoked_at IS NULL AND (q.expires_at IS NULL OR q.expires_at>now())))";
/** Operator/admin service: no password, account-role or Procurement changes. */
export async function setRegionalQcDelegation(pool:Pool,actor:string,input:{email:string;team:'central'|'south';enabled:boolean;reason:string}){
 if(input.reason.trim().length<3||input.reason.length>2000)throw new HttpError(422,'Give an access-change reason.');
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);
  const admin=(await c.query('SELECT role FROM users WHERE id=$1 AND active',[actor])).rows[0];if(admin?.role!=='Admin')throw new HttpError(403,'Only Admin can change additional QC duty.');
  const user=(await c.query('SELECT id,role,active FROM users WHERE email=$1 FOR UPDATE',[input.email])).rows[0];if(!user?.active||user.role!=='Operations')throw new HttpError(422,'Choose an active Operations lead.');
  const access=(await c.query('SELECT kind,team FROM operations_board_access WHERE user_id=$1 FOR UPDATE',[user.id])).rows[0];
  if(access?.kind!=='lead'||access.team!==input.team)throw new HttpError(422,'Additional QC duty must match the lead’s current region.');
  if(input.enabled)await c.query('INSERT INTO operations_board_qc_delegations(user_id,team,granted_by,reason) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET team=EXCLUDED.team,granted_by=EXCLUDED.granted_by,reason=EXCLUDED.reason,granted_at=now(),expires_at=NULL,revoked_at=NULL',[user.id,input.team,actor,input.reason.trim()]);
  else await c.query('UPDATE operations_board_qc_delegations SET revoked_at=now() WHERE user_id=$1',[user.id]);
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`operations.board.qc-delegation.${input.enabled?'grant':'revoke'}:${user.id}:${input.team}:${input.reason.trim()}`]);
  return {email:input.email,team:input.team,qc:input.enabled,leadRetained:true};
 });
}
