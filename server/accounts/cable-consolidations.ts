import {createHash,randomUUID} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import {transaction} from '../db/transaction.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {AccountsRepository} from './repository.js';
import {HttpError} from '../http/errors.js';
import {paymentRegisterData} from './payment-records.js';

export const cableConsolidationSchema=z.object({sourceVersion:z.number().int().positive(),sourceRowIds:z.array(z.string().min(1).max(500)).min(2).max(100),invoice:z.string().regex(/^\d{2}-\d{4,}$/),invoiceDate:z.iso.date(),customerPo:z.string().trim().max(200).optional(),amount:z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/),reason:z.string().trim().min(1).max(2000),file:z.object({name:z.string().trim().min(1).max(200),base64:z.string().min(4).max(2800000)}).strict(),requestKey:z.uuid()}).strict();
export const cableSubmissionSchema=z.object({sourceVersion:z.number().int().positive(),key:z.uuid(),submissionDate:z.iso.date(),requestKey:z.uuid()}).strict();
async function latest(c:PoolClient){return (await c.query('SELECT * FROM accounts_source_registers ORDER BY version DESC LIMIT 1')).rows[0];}
async function freeze(c:PoolClient,previous:any,snapshot:any,actor:string,action:string){
 const id=randomUUID(),sha=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
 await c.query('INSERT INTO accounts_source_registers(id,version,source_sha256,source_date,snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6)',[id,previous.version+1,sha,previous.source_date,snapshot,actor]);
 await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,action+':'+id]);
 return previous.version+1;
}
/** New immutable source version; retain superseded invoices and original evidence.
 * No stock, journal, receipt or payment table is posted by consolidation. */
export async function consolidateCableInvoices(pool:Pool,actor:string,raw:unknown){
 const input=cableConsolidationSchema.parse(raw),amount=new Decimal(input.amount);
 if(!amount.gt(0)||new Set(input.sourceRowIds).size!==input.sourceRowIds.length)throw new HttpError(422,'Select distinct invoices and enter a positive consolidated amount.');
 if(input.invoiceDate>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))throw new HttpError(422,'Invoice date cannot be in the future.');
 const bytes=Buffer.from(input.file.base64,'base64');
 if(bytes.length>2000000||!(/\.xlsx$/i.test(input.file.name)&&bytes.subarray(0,2).toString()==='PK'||/\.pdf$/i.test(input.file.name)&&bytes.subarray(0,5).toString()==='%PDF-'))throw new HttpError(422,'Attach the original consolidated XLSX or PDF, up to 2 MB.');
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);await new AccountsRepository(pool).access(actor,c,true);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('accounts.source-register',0))");
  const previous=await latest(c);if(!previous)throw new HttpError(409,'Accounts source register is unavailable.');
  const replay=previous.snapshot.cables.rows.find((r:any)=>r.consolidation?.requestKey===input.requestKey);
  if(replay){if(replay.consolidation.requestHash!==createHash('sha256').update(JSON.stringify(input)).digest('hex'))throw new HttpError(409,'This request key belongs to a different consolidation.');return {key:replay.key,invoice:replay.invoice,version:previous.version};}
  if(previous.version!==input.sourceVersion)throw new HttpError(409,'Invoice records changed. Refresh before consolidating.');
  const register=await paymentRegisterData(c),selected=input.sourceRowIds.map(id=>register.invoices.find(r=>r.id===id));
  if(selected.some(r=>!r||r.category!=='Extra cable'||r.consolidation||r.amount==null||r.pending==null||!new Decimal(r.amount).eq(r.pending)||r.receiptConfirmed||r.receiptVersion||r.correctionVersion||r.receiptHold||r.invoiceCorrectionHold))throw new HttpError(409,'Only unchanged, fully unpaid cable invoices can be replaced. Review payments or invoice corrections first.');
  const customer=selected[0]!.customer;if(selected.some(r=>r!.customer!==customer))throw new HttpError(422,'Select cable invoices from one customer.');
  if(register.invoices.some(r=>!input.sourceRowIds.includes(r.id)&&r.customer===customer&&r.invoice===input.invoice))throw new HttpError(409,'An invoice with this number already exists outside the selected records.');
  const sourceRows=input.sourceRowIds.map(id=>previous.snapshot.cables.rows.find((r:any)=>'cable:'+r.key===id&&!r.supersededBy));
  if(sourceRows.some(r=>!r))throw new HttpError(409,'A selected source invoice is no longer active.');
  const key=randomUUID(),sites=sourceRows.flatMap(r=>r.sites??[]),file={...input.file,sha256:createHash('sha256').update(bytes).digest('hex')};
  const snapshot=structuredClone(previous.snapshot);
  for(const r of snapshot.cables.rows)if(input.sourceRowIds.includes('cable:'+r.key))r.supersededBy=key;
  snapshot.cables.rows.push({key,po:input.customerPo??'',program:sourceRows[0].program,invoice:input.invoice,sites,siteLabel:sites.length+' branches · '+customer,invoicedAmount:amount.toFixed(2),pendingAmount:amount.toFixed(2),minimumOnly:false,paymentReceived:false,submission:'Created — submission pending',observations:[],notes:[input.reason],consolidation:{requestKey:input.requestKey,requestHash:createHash('sha256').update(JSON.stringify(input)).digest('hex'),invoiceDate:input.invoiceDate,sourceRowIds:input.sourceRowIds,previousInvoices:selected.map(r=>({id:r!.id,invoice:r!.invoice,site:r!.site,amount:r!.amount,pending:r!.pending})),file,createdBy:actor,createdAt:new Date().toISOString()}});
  const version=await freeze(c,previous,snapshot,actor,'accounts.cable-invoices.consolidated');return {key,invoice:input.invoice,version};
 });
}
export async function submitConsolidatedCable(pool:Pool,actor:string,raw:unknown,now=new Date()){
 const input=cableSubmissionSchema.parse(raw),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(input.submissionDate>today)throw new HttpError(422,'Actual submission date cannot be in the future.');
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);await new AccountsRepository(pool).access(actor,c);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('accounts.source-register',0))");
  const previous=await latest(c),snapshot=structuredClone(previous?.snapshot),row=snapshot?.cables.rows.find((r:any)=>r.key===input.key&&r.consolidation&&!r.supersededBy);
  if(!row)throw new HttpError(404,'Consolidated invoice not found.');
  if(row.consolidation.submissionRequestKey===input.requestKey&&row.submittedOn===input.submissionDate)return {invoice_reference:row.invoice,submitted_on:row.submittedOn};
  if(previous.version!==input.sourceVersion||row.submittedOn)throw new HttpError(409,'Invoice changed or submission is already recorded.');
  if(input.submissionDate<row.consolidation.invoiceDate)throw new HttpError(422,'Submission cannot be before the invoice date.');
  row.submission='Submitted';row.submittedOn=input.submissionDate;row.consolidation.submissionRequestKey=input.requestKey;row.consolidation.submittedBy=actor;
  await freeze(c,previous,snapshot,actor,'accounts.cable-invoice.submitted');return {invoice_reference:row.invoice,submitted_on:row.submittedOn};
 });
}
