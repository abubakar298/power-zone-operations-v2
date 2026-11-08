import type {Pool,PoolClient} from 'pg';

const label=(value:unknown)=>typeof value==='string'&&value.trim()&&!/^(ubl:\d+|ipo:[0-9a-f-]+)$/i.test(value.trim())?value.replace(/\s+/g,' ').trim():'Not recorded';
export function closureNotificationId(sourceKey:string){
 return /^handoff:closure:([0-9a-f-]{36}):[0-9a-f-]{36}(?:\/(?:reminder|escalation))?$/i.exec(sourceKey)?.[1];
}

/** Human-readable identity from the submitted version. Only the four labels leave this query. */
export async function closureNotificationIdentities(c:Pool|PoolClient,ids:string[]){
 if(!ids.length)return new Map<string,{reference:string;details:string[]}>();
 const rows=(await c.query(`SELECT j.id,
  COALESCE(NULLIF(snapshot->>'jobId',''),snapshot#>>'{identity,job_id}') AS ipo,
  COALESCE(NULLIF(snapshot#>>'{identity,site_name}',''),NULLIF(snapshot->>'siteName',''),snapshot->>'title') AS site,
  COALESCE(NULLIF(snapshot#>>'{customer,name}',''),NULLIF(snapshot->>'customerName',''),
   (SELECT name FROM customers WHERE short_code=j.snapshot#>>'{identity,customer_code}' LIMIT 1),snapshot#>>'{identity,customer_code}') AS customer,
  COALESCE(NULLIF(snapshot#>>'{identity,configuration_id}',''),snapshot->>'solutionId') AS configuration
  FROM accounts_job_closures j WHERE j.id=ANY($1::uuid[]) AND j.stage='Awaiting Management'`,[ids])).rows;
 return new Map(rows.map(row=>{
  const values=[row.ipo,row.site,row.customer,row.configuration].map(label);
  return [row.id,{reference:values.join(' | '),details:values.map((value,i)=>`${['IPO','Site','Customer','Site config'][i]}: ${value}`)}];
 }));
}

export async function closureEmailIdentity(c:PoolClient,row:{event_source_key:string;event_kind:string;audience:string;role:string}){
 if(row.event_kind!=='Closure approval required')return null;
 if(!['management','assigned'].includes(row.audience)||!['Admin','Management'].includes(row.role))throw Error('Closure email recipient is not authorised');
 const id=closureNotificationId(row.event_source_key);
 if(!id)throw Error('Closure email source is unavailable');
 const identity=(await closureNotificationIdentities(c,[id])).get(id);
 if(!identity)throw Error('Submitted closure identity is unavailable');
 return identity;
}
