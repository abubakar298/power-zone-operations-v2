import type {PoolClient} from 'pg';

const label=(value:unknown)=>typeof value==='string'&&value.trim()&&!/^(ubl:\d+|ipo:[0-9a-f-]+)$/i.test(value.trim())?value.replace(/\s+/g,' ').trim():'Not recorded';
/** Resolve the exact submitted closure, not a newer revision or the internal job key.
 * Select only human-readable identity metadata; no costs enter the email. */
export async function closureEmailIdentity(c:PoolClient,row:{event_source_key:string;event_kind:string;audience:string;role:string}){
 if(row.event_kind!=='Closure approval required')return null;
 // Workflow handoffs are addressed to an exact assigned Management user.
 if(!['management','assigned'].includes(row.audience)||!['Admin','Management'].includes(row.role))throw Error('Closure email recipient is not authorised');
 const match=/^handoff:closure:([0-9a-f-]{36}):[0-9a-f-]{36}$/i.exec(row.event_source_key);
 if(!match)throw Error('Closure email source is unavailable');
 const saved=(await c.query(`SELECT
  COALESCE(NULLIF(snapshot->>'jobId',''),snapshot#>>'{identity,job_id}') AS ipo,
  COALESCE(NULLIF(snapshot#>>'{identity,site_name}',''),NULLIF(snapshot->>'siteName',''),snapshot->>'title') AS site,
  COALESCE(NULLIF(snapshot#>>'{customer,name}',''),NULLIF(snapshot->>'customerName',''),
   (SELECT name FROM customers WHERE short_code=j.snapshot#>>'{identity,customer_code}' LIMIT 1),snapshot#>>'{identity,customer_code}') AS customer,
  COALESCE(NULLIF(snapshot#>>'{identity,configuration_id}',''),snapshot->>'solutionId') AS configuration
  FROM accounts_job_closures j WHERE id=$1 AND stage='Awaiting Management'`,[match[1]])).rows[0];
 if(!saved)throw Error('Submitted closure identity is unavailable');
 const values=[saved.ipo,saved.site,saved.customer,saved.configuration].map(label);
 const details=values.map((value,i)=>`${['IPO','Site','Customer','Site config'][i]}: ${value}`);
 return {reference:values.join(' | '),details};
}
