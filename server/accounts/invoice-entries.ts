import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {lockActiveActor} from '../auth/actor-lock.js';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';
import {AccountsRepository} from './repository.js';
import {invoicingQueues} from './billing-model.js';
export const invoiceEntrySchema=z.object({sourceKind:z.enum(['Operations','Source register']),siteKey:z.string().min(1).max(160),sourceVersion:z.number().int().positive(),milestone:z.enum(['delivery','completion']),ptReference:z.string().trim().min(1).max(200),entryDate:z.iso.date(),notes:z.string().trim().max(2000),requestKey:z.uuid()}).strict();
type Db=Pool|PoolClient;
export function operationsInvoiceRows(rows:any[],registers:any[]=[]){
 const result:any[]=[];
 for(const row of rows){const s=row.snapshot;
  if(s.cancelled||s.transferred||s.scopePending)continue;
  const approved=registers.flatMap(r=>r.rows??[]).find(r=>r.ipo===s.ipo&&r.site===s.name);
  const deliveryOnly=s.installation===false||s.projectType==='delivery-only';
  const ups=approved?.kind==='UPS'||s.projectType==='ups';
  const deliveryMilestone=deliveryOnly||!ups&&(approved?.program==='Solar 70'||s.invoiceOnDelivery===true);
  const completionMilestone=!deliveryOnly&&(s.installation===true||ups||approved?.program==='Solar 70');
  const base={key:row.site_id,sourceKind:'Operations',sourceVersion:row.version,site:s.name,ipo:s.ipo,po:s.customerPo??s.po??'',program:s.projectType??'',deliveryDate:s.deliveryDate,installationDate:s.qc?.handover?.date??s.qc?.signoff?.date??s.qcJob?.date,documents:s.documents??[],evidence:(s.documents??[]).flatMap((d:any)=>(d.evidence??[]).filter((f:any)=>z.uuid().safeParse(f.id).success).map((f:any)=>({id:f.id,filename:f.name??'Supporting document',url:`/api/operations-board/sites/${encodeURIComponent(row.site_id)}/files/${f.id}`})))};
  if(deliveryMilestone&&(s.stage==='delivered'||s.stage==='completed'||s.completed===true))result.push({...base,milestone:'delivery'});
  if(completionMilestone&&(s.completed===true||s.stage==='completed'))result.push({...base,milestone:'completion'});
 }
 return result;
}
async function candidates(c:Db){
 const source=(await c.query('SELECT version,snapshot FROM accounts_source_registers ORDER BY version DESC LIMIT 1')).rows[0];
 const operations=operationsInvoiceRows((await c.query('SELECT DISTINCT ON(site_id) site_id,version,snapshot FROM operations_board_versions ORDER BY site_id,version DESC')).rows,source?.snapshot.registers??[]);
 const queues=source?invoicingQueues(source.snapshot.registers):{delivery:[],completion:[],alreadyIssued:[]};
 const sameSite=(a:any,b:any)=>String(a.ipo??'').trim().toLowerCase()===String(b.ipo??'').trim().toLowerCase()&&String(a.site??'').trim().toLowerCase()===String(b.site??'').trim().toLowerCase();
 const issued=(queues.alreadyIssued as any[]);
 const eligibleOperations=operations.filter(o=>!issued.some(r=>sameSite(r,o)&&(r.milestone===o.milestone||r.milestone==='advance'&&o.milestone==='delivery')));
 const legacy=['delivery','completion'].flatMap(milestone=>(queues[milestone as 'delivery'|'completion'] as any[]).filter(r=>!operations.some(o=>o.ipo===r.ipo&&o.site===r.site)).map(r=>({...r,sourceKind:'Source register',sourceVersion:source.version,milestone})));
 return [...eligibleOperations,...legacy];
}
export async function invoiceRegister(pool:Pool,actor:string){
 const role=await new AccountsRepository(pool).access(actor);
 const rows=await candidates(pool),entries=(await pool.query('SELECT *,entry_date::text AS entry_date FROM accounts_invoice_entries ORDER BY created_at DESC')).rows;
 return {canRecord:['Admin','Accounts'].includes(role),queues:{delivery:rows.filter(r=>r.milestone==='delivery'&&!entries.some(e=>((e.source_kind===r.sourceKind&&e.site_key===r.key)||(e.snapshot.ipo===r.ipo&&e.snapshot.site===r.site))&&e.milestone==='delivery')),completion:rows.filter(r=>r.milestone==='completion'&&!entries.some(e=>((e.source_kind===r.sourceKind&&e.site_key===r.key)||(e.snapshot.ipo===r.ipo&&e.snapshot.site===r.site))&&e.milestone==='completion'))},entries};
}
export async function recordInvoiceEntry(pool:Pool,actor:string,input:z.infer<typeof invoiceEntrySchema>){
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);
  const role=await new AccountsRepository(pool).access(actor,c);if(!['Admin','Accounts'].includes(role))throw new HttpError(403,'Accounts invoice recording access required.');
  await c.query("SELECT pg_advisory_xact_lock(hashtext('accounts.invoice-register'))");
  const old=(await c.query('SELECT *,entry_date::text AS entry_date FROM accounts_invoice_entries WHERE request_key=$1',[input.requestKey])).rows[0];
  if(old){if(old.created_by===actor&&Object.entries(input).every(([k,v])=>old.request[k]===v))return old;
   throw new HttpError(409,'Request key already used.');}
  if(input.sourceKind==='Operations')await c.query('SELECT id FROM operations_board_sites WHERE id=$1 FOR UPDATE',[input.siteKey]);
  else await c.query("SELECT pg_advisory_xact_lock(hashtextextended('accounts.source-register',0))");
  const source=(await candidates(c)).find(r=>r.sourceKind===input.sourceKind&&r.key===input.siteKey&&r.milestone===input.milestone);
  if(!source||source.sourceVersion!==input.sourceVersion)throw new HttpError(409,'Site milestone or documents changed. Reload and review before recording the invoice.');
  const duplicate=(await c.query("SELECT id FROM accounts_invoice_entries WHERE ((source_kind=$1 AND site_key=$2) OR (snapshot->>'ipo'=$4 AND snapshot->>'site'=$5)) AND milestone=$3",[input.sourceKind,input.siteKey,input.milestone,source.ipo,source.site])).rows[0];
  if(duplicate)throw new HttpError(409,'This site milestone already has a recorded invoice.');
  const row=(await c.query('INSERT INTO accounts_invoice_entries(id,source_kind,site_key,source_version,milestone,pt_reference,entry_date,notes,snapshot,request,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *,entry_date::text AS entry_date',[randomUUID(),input.sourceKind,input.siteKey,input.sourceVersion,input.milestone,input.ptReference,input.entryDate,input.notes,source,input,input.requestKey,actor])).rows[0];
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'accounts.invoice-entry:'+row.id]);return row;
 });
}
