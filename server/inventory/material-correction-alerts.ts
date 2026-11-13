import type {Pool} from 'pg';
import {z} from 'zod';
import {HttpError} from '../http/errors.js';
import {transaction} from '../db/transaction.js';
import {lockActiveActor} from '../auth/actor-lock.js';
/** Caller authorizes Accounts or Inventory; these are documentary alerts only. */
export async function materialCorrectionAlerts(pool:Pool){
 return {alerts:(await pool.query("SELECT a.id,a.message,a.created_at,o.site_name,o.legacy_ipo_number FROM ubl_documentation_alerts a JOIN ubl_site_orders o ON o.site_id=a.site_id WHERE a.id LIKE 'material-recon:%' AND a.status='Open' AND NOT EXISTS(SELECT 1 FROM ubl_documentation_alert_resolutions r WHERE r.alert_id=a.id) ORDER BY a.created_at DESC,a.id")).rows};
}
const resolveSchema=z.object({note:z.string().trim().min(3).max(2000),requestKey:z.uuid()}).strict();
/** Close an open correction once the work is done. Management, Accounts and Inventory
 * dispatchers may resolve; the alert row is kept and the resolution is recorded. */
export async function resolveMaterialCorrection(pool:Pool,actor:string,id:string,raw:unknown){
 const parsed=resolveSchema.safeParse(raw);if(!parsed.success)throw new HttpError(422,'Write how this correction was resolved.');const v=parsed.data;
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);
  const user=(await c.query('SELECT role FROM users WHERE id=$1',[actor])).rows[0];
  const allowed=['Admin','Management','Accounts'].includes(user?.role)||user?.role==='Inventory'&&(await c.query("SELECT 1 FROM inventory_material_access WHERE user_id=$1 AND capability='dispatcher' LIMIT 1",[actor])).rowCount;
  if(!allowed)throw new HttpError(403,'Management, Accounts or Inventory resolves reconciliation corrections.');
  const replay=(await c.query('SELECT alert_id,note,resolved_by FROM ubl_documentation_alert_resolutions WHERE request_key=$1',[v.requestKey])).rows[0];
  if(replay){if(replay.alert_id!==id||replay.note!==v.note||replay.resolved_by!==actor)throw new HttpError(409,'This request belongs to another resolution.');return {id,resolved:true};}
  const alert=(await c.query("SELECT id FROM ubl_documentation_alerts WHERE id=$1 AND id LIKE 'material-recon:%' FOR UPDATE",[id])).rows[0];
  if(!alert)throw new HttpError(404,'Correction alert not found.');
  if((await c.query('SELECT 1 FROM ubl_documentation_alert_resolutions WHERE alert_id=$1',[id])).rowCount)throw new HttpError(409,'This correction is already resolved.');
  await c.query('INSERT INTO ubl_documentation_alert_resolutions(alert_id,note,resolved_by,request_key) VALUES($1,$2,$3,$4)',[id,v.note,actor,v.requestKey]);
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'inventory.material-correction-resolved:'+id]);
  return {id,resolved:true};
 });
}
const schema=z.object({ipoNumber:z.string().trim().regex(/^\d{1,6}$/),message:z.string().trim().min(10).max(3000),requestKey:z.uuid()}).strict();
export async function flagMaterialCorrection(pool:Pool,actor:string,raw:unknown){
 const parsed=schema.safeParse(raw);if(!parsed.success)throw new HttpError(422,'Enter the site IPO number and correction details.');const v=parsed.data,id='material-recon:'+v.requestKey;
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);const user=(await c.query('SELECT role FROM users WHERE id=$1',[actor])).rows[0];if(!['Admin','Management'].includes(user?.role))throw new HttpError(403,'Management records reconciliation corrections.');
  const sites=(await c.query('SELECT site_id FROM ubl_site_orders WHERE legacy_ipo_number=$1',[v.ipoNumber])).rows;if(sites.length!==1)throw new HttpError(422,'Select an exact registered site IPO.');
  const old=(await c.query('SELECT site_id,message FROM ubl_documentation_alerts WHERE id=$1',[id])).rows[0];if(old){if(old.site_id!==sites[0].site_id||old.message!==v.message)throw new HttpError(409,'This request belongs to another correction.');return {id,stockPosting:false};}
  await c.query('INSERT INTO ubl_documentation_alerts(id,site_id,message) VALUES($1,$2,$3)',[id,sites[0].site_id,v.message]);
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'inventory.material-correction-alert:'+id]);
  return {id,stockPosting:false};
 });
}
