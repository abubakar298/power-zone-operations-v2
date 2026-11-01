import type {Pool} from 'pg';
import {AccountsRepository} from './repository.js';
import {customerDocuments} from './customer-documents.js';
import {InventoryRepository} from '../inventory/repository.js';

/** One pending task per exact job, never a join by a shared PO or site name. */
export async function materialCostingQueue(pool:Pool,actor:string){
 await new AccountsRepository(pool).access(actor);
 const [documents,reports,closures,entries]=await Promise.all([
  customerDocuments(pool),new InventoryRepository(pool).list(actor),
  pool.query('SELECT DISTINCT ON(job_key) job_key,stage FROM accounts_active_job_closures ORDER BY job_key,version DESC'),
  pool.query("SELECT source_id,source_version,pt_reference FROM accounts_pt_entries WHERE source_kind='Inventory'")
 ]);
 return {rows:projectMaterialCostingQueue(documents.rows,reports,closures.rows,entries.rows),stockPosting:false};
}
export function projectMaterialCostingQueue(documents:any[],reports:any[],closures:any[],entries:any[]){
 const finished=new Set(closures.filter(r=>['Closed','Awaiting Management'].includes(r.stage)).map(r=>r.job_key));
 const rows=new Map<string,any>();
 for(const r of reports.filter(r=>r.stage==='Sent to Accounts')){
  if(finished.has(r.job_key)||entries.some(p=>p.source_id===r.id&&p.source_version===r.version))continue;
  rows.set(r.job_key,{key:r.job_key,jobKey:r.job_key,siteName:r.site_name,ipo:r.job_id,customer:r.customer_code??'',receivedAt:r.created_at,report:r,documents:[],status:'Ready for PT entry'});
 }
 for(const d of documents){
  if(d.jobKey&&finished.has(d.jobKey))continue;
  const report=reports.find(r=>r.job_key===d.jobKey&&r.stage==='Sent to Accounts');
  if(report&&entries.some(p=>p.source_id===report.id&&p.source_version===report.version))continue;
  const key=d.jobKey??d.siteId;
  if(!rows.has(key))rows.set(key,{key,jobKey:d.jobKey,siteName:d.siteName,ipo:d.ipo,customer:d.customer,receivedAt:d.receivedAt,report:null,documents:[],status:'Awaiting QC usage'});
  const row=rows.get(key);row.siteId=d.siteId;row.documents.push(d);if(d.receivedAt>row.receivedAt)row.receivedAt=d.receivedAt;
 }
 return [...rows.values()].sort((a,b)=>String(b.receivedAt).localeCompare(String(a.receivedAt))||a.key.localeCompare(b.key));
}
