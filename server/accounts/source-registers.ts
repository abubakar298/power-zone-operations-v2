import{invoiceReceipts,applyInvoiceReceipts}from'./invoice-receipt-state.js';
import {invoiceSubmissions,applyInvoiceSubmissionBilling,applyInvoiceSubmissionStages} from './invoice-submission-state.js';
import {latestOperationsStages,projectAccountsSites} from './site-projection.js';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {z} from 'zod';
import {Decimal} from 'decimal.js';
import {HttpError} from '../http/errors.js';
import {transaction} from '../db/transaction.js';
import {billingRows,customerTotals,invoicingQueues,ageBand} from './billing-model.js';

const row=z.record(z.string(),z.any());
const register=z.object({rows:z.array(row).max(20000)}).passthrough();
export const accountsSourceSchema=z.object({
 sourceDate:z.iso.date(),
 manifest:z.array(z.object({name:z.string().min(1).max(200),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1).max(30),
 registers:z.array(register).min(1).max(10),cables:register,internet:register,
 evidence:z.object({rows:z.array(row).max(20000),cableStageAdjustments:z.array(row).max(20000)}).passthrough(),
 sites:register,
}).strict();
export type AccountsSource=z.infer<typeof accountsSourceSchema>;

/** Source-only reports. Importing never creates financial or stock transactions. */
export class AccountsSourceRegisters {
 constructor(private pool:Pool){}
 private async access(actor:string,admin=false){
  const user=(await this.pool.query('SELECT role,active FROM users WHERE id=$1',[actor])).rows[0];
  if(!user?.active)throw new HttpError(401,'Your access has ended.');
  if(!(admin?['Admin']:['Admin','Management','Accounts']).includes(user.role))throw new HttpError(403,admin?'Administrator access required.':'Accounts access required.');
 }
 async import(actor:string,input:AccountsSource,expectedVersion:number){
  await this.access(actor,true);
  const source=accountsSourceSchema.parse(input);
  // Refuse unreadable monetary inputs before freezing a source version.
  const rows=billingRows(source.registers,source.cables,source.internet,source.evidence);
  const ids=new Set<string>();
  for(const item of rows){
   if(ids.has(item.id))throw new HttpError(422,'Duplicate source invoice row identity.');
   ids.add(item.id);
   for(const key of ['amount','pending'])if(item[key]!=null){
    try{if(!new Decimal(item[key]).isFinite())throw Error();}catch{throw new HttpError(422,'A source invoice amount is invalid.');}
   }
  }
  const sha=createHash('sha256').update(JSON.stringify(source)).digest('hex');
  return transaction(this.pool,async c=>{
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('accounts.source-register',0))");
   const previous=(await c.query('SELECT id,version,source_sha256 FROM accounts_source_registers WHERE source_sha256=$1',[sha])).rows[0];
   if(previous)return previous;
   const current=(await c.query('SELECT COALESCE(max(version),0)::integer AS version FROM accounts_source_registers')).rows[0].version;
   if(current!==expectedVersion)throw new HttpError(409,'The source register changed. Review the latest version before importing.');
   const saved=(await c.query('INSERT INTO accounts_source_registers(id,version,source_sha256,source_date,snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,version,source_sha256',[randomUUID(),current+1,sha,source.sourceDate,source,actor])).rows[0];
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'accounts.source-register.import:'+saved.id]);
   return saved;
  });
 }
 private async latest(actor:string){
  await this.access(actor);
  const record=(await this.pool.query('SELECT version,source_date::text,source_sha256,snapshot FROM accounts_source_registers ORDER BY version DESC LIMIT 1')).rows[0];
  if(!record)throw new HttpError(409,'The reviewed Accounts source register has not been imported.');
  return record as {version:number;source_date:string;source_sha256:string;snapshot:AccountsSource};
 }
 async billing(actor:string,now=new Date()){
  const record=await this.latest(actor),s=record.snapshot;
  const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const submissions=await invoiceSubmissions(this.pool);
  const rows=applyInvoiceReceipts(applyInvoiceSubmissionBilling(billingRows(s.registers,s.cables,s.internet,s.evidence),submissions),await invoiceReceipts(this.pool)).map((r):Record<string,any>=>({...r,band:ageBand(r.date,asOf)}));
  const generalReceipts=s.evidence.generalReceipts??[];
  return {generalReceipts,asOf,sourceAsOf:record.source_date,sourceVersion:record.version,readOnlySource:true,rows,customers:customerTotals(rows,asOf),queues:invoicingQueues(applyInvoiceSubmissionStages(s,submissions).registers),verification:{sourceModified:s.evidence.sourceModified,scope:'Reviewed source invoices; unknown original invoice amounts remain missing.'}};
 }
 async sites(actor:string){const r=await this.latest(actor);return {...projectAccountsSites(r.snapshot,await latestOperationsStages(this.pool)),sourceVersion:r.version,readOnlySource:true};}
 async summary(actor:string){
  await this.access(actor);
  const r=(await this.pool.query('SELECT version,source_sha256,snapshot FROM accounts_source_registers ORDER BY version DESC LIMIT 1')).rows[0];
  return r?{asOf:r.snapshot.sites.asOf,importId:r.source_sha256,sourceVersion:r.version,counts:projectAccountsSites(r.snapshot,await latestOperationsStages(this.pool)).counts}:null;
 }
}
