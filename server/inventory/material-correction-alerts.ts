import type {Pool} from 'pg';
import {z} from 'zod';
import {HttpError} from '../http/errors.js';
import {transaction} from '../db/transaction.js';
import {lockActiveActor} from '../auth/actor-lock.js';
/** Caller authorizes Accounts or Inventory; these are documentary alerts only. */
export async function materialCorrectionAlerts(pool:Pool){
 return {alerts:(await pool.query("SELECT a.id,a.message,a.created_at,o.site_name,o.legacy_ipo_number FROM ubl_documentation_alerts a JOIN ubl_site_orders o ON o.site_id=a.site_id WHERE a.id LIKE 'material-recon:%' AND a.status='Open' ORDER BY a.created_at DESC,a.id")).rows};
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
