import type {Pool} from 'pg';
import {transaction} from '../db/transaction.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {HttpError} from '../http/errors.js';
import {z} from 'zod';
const inputSchema=z.object({jobKeys:z.array(z.string().regex(/^(ubl:\d+|ipo:[0-9a-f-]{36})$/i)).min(1).max(50),excluded:z.boolean(),reason:z.string().trim().min(3).max(2000)}).strict();
/** Operator-only, owner-authorised eligibility adjustment; never changes closure costs/stages. */
export async function setClosureComparisonExclusions(pool:Pool,actor:string,input:z.infer<typeof inputSchema>){
 const value=inputSchema.parse(input),keys=[...new Set(value.jobKeys)];
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);
  const user=(await c.query('SELECT role FROM users WHERE id=$1',[actor])).rows[0];
  if(!['Admin','Management'].includes(user?.role))throw new HttpError(403,'Management comparison authorisation required.');
  const known=(await c.query("SELECT 'ubl:'||site_id AS key FROM ubl_site_orders WHERE 'ubl:'||site_id=ANY($1::text[]) UNION SELECT 'ipo:'||id AS key FROM internal_purchase_orders WHERE 'ipo:'||id=ANY($1::text[])",[keys])).rows;
  if(known.length!==keys.length)throw new HttpError(422,'An exact registered job identity is required.');
  for(const key of keys){
   await c.query(`INSERT INTO closure_comparison_exclusions(job_key,excluded,reason,updated_by) VALUES($1,$2,$3,$4)
    ON CONFLICT(job_key) DO UPDATE SET excluded=EXCLUDED.excluded,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=now()`,[key,value.excluded,value.reason,actor]);
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`closure.comparison.${value.excluded?'excluded':'included'}:${key}:${value.reason}`]);
  }
  return {jobKeys:keys,excluded:value.excluded};
 });
}
