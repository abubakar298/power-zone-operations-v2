import type {PoolClient} from 'pg';
import {HttpError} from '../http/errors.js';
import {siteBucket,type WorkflowSite,type FileReference} from './workflow.js';
/** A customer-cancelled site. Saved deliveries, DOs, stock, invoices and closures are never
 * changed here, so a site that already has any of them is refused and needs Management review. */
export async function siteCancellationBlockers(c:PoolClient,id:string,site:WorkflowSite){
 const reasons:string[]=[];
 if(site.completed||siteBucket(site)==='completed')reasons.push('the work is already recorded as complete');
 else if(site.deliveries?.length||site.stage==='delivered')reasons.push('a delivery is already recorded');
 if(site.qcJob||Object.keys(site.qc??{}).length)reasons.push('installation / QC progress is recorded');
 const batches=site.planningBatches.filter(b=>b.stops.some(stop=>stop.siteId===id)).map(b=>b.number??'a shared visit');
 if(batches.length)reasons.push(`it is planned in ${batches.join(', ')} (remove it there first with Batch planning → Edit batch)`);
 const ipoId=(site as {origin?:{ipoId?:string}}).origin?.ipoId??null;
 const dos=(await c.query(`SELECT d.number FROM inventory_material_dispatches_active d WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(d.snapshot->'sites') s
  WHERE s->>'registeredSiteId'=$1 OR (nullif(s->>'registeredSiteId','') IS NULL AND $2::text IS NOT NULL AND s->>'siteId'=$2)) ORDER BY d.number`,[id,ipoId])).rows.map(r=>String(r.number));
 if(dos.length)reasons.push(`Inventory has issued ${dos.length===1?'DO':'DOs'} ${dos.join(', ')}`);
 const invoices=(await c.query(`SELECT 1 FROM accounts_invoice_entries WHERE source_kind='Operations' AND site_key=$1 UNION ALL SELECT 1 FROM accounts_invoice_submissions WHERE source_kind='Operations' AND site_key=$1 LIMIT 1`,[id])).rowCount;
 if(invoices)reasons.push('Accounts has recorded an invoice for it');
 return reasons;
}
export function cancelSite(site:WorkflowSite,input:{reason:string;actor:string;name:string;proof:FileReference[]},now:string):WorkflowSite{
 return {...site,cancelled:true,cancellation:{reason:input.reason,proof:input.proof,cancelledBy:input.name,cancelledById:input.actor,cancelledAt:now,stageAtCancellation:site.stage},
  history:[...site.history,{date:now,description:`${input.name} cancelled this site. Reason: ${input.reason}`}]};
}
export function requireNotCancelled(site:Record<string,unknown>){
 if(site.cancelled===true)throw new HttpError(409,'This site was cancelled. Its history stays available, but new work cannot be recorded.');
}
