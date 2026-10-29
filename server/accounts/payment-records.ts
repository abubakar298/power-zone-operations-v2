import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {AccountsRepository} from './repository.js';
import {billingRows} from './billing-model.js';
import {paymentQueue} from '../../shared/accounts-payment-queue.js';
import {transaction} from '../db/transaction.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {HttpError} from '../http/errors.js';

export const paymentRecordSchema=z.object({sourceRowId:z.string().min(1).max(500),sourceVersion:z.number().int().positive(),transactionId:z.string().trim().min(1).max(200),paymentDate:z.iso.date(),requestKey:z.uuid()}).strict();
async function readRegister(db:Pool|PoolClient){
 const source=(await db.query('SELECT version,snapshot FROM accounts_source_registers ORDER BY version DESC LIMIT 1')).rows[0];
 const entries=(await db.query('SELECT *,payment_date::text AS payment_date FROM accounts_payment_records ORDER BY created_at DESC')).rows;
 const s=source?.snapshot;
 const rows=s?billingRows(s.registers,s.cables,s.internet,s.evidence):[];
 return {sourceVersion:source?.version??null,pending:paymentQueue(rows,entries),entries};
}
export async function paymentRegister(pool:Pool,actor:string){
 const role=await new AccountsRepository(pool).access(actor);
 return {...await readRegister(pool),canRecord:['Admin','Accounts'].includes(role)};
}
export async function recordPayment(pool:Pool,actor:string,input:z.infer<typeof paymentRecordSchema>){
 return transaction(pool,async db=>{
  await lockActiveActor(db,actor);
  const role=await new AccountsRepository(pool).access(actor,db);
  if(!['Admin','Accounts'].includes(role))throw new HttpError(403,'Accounts payment recording access required.');
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('accounts.source-register',0))");
  const previous=(await db.query('SELECT * FROM accounts_payment_records WHERE request_key=$1',[input.requestKey])).rows[0];
  if(previous){
   if(previous.created_by===actor&&Object.entries(input).every(([k,v])=>previous.request[k]===v))return previous;
   throw new HttpError(409,'Request key already used.');
  }
  const register=await readRegister(db),source=register.pending.find(r=>r.id===input.sourceRowId);
  if(!source||register.sourceVersion!==input.sourceVersion)throw new HttpError(409,'Payment source changed or transaction details were already recorded. Refresh the queue.');
  const row=(await db.query('INSERT INTO accounts_payment_records(id,source_row_id,source_version,transaction_id,payment_date,snapshot,request,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
   [randomUUID(),input.sourceRowId,input.sourceVersion,input.transactionId,input.paymentDate,source,input,input.requestKey,actor])).rows[0];
  await db.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'accounts.payment-record:'+row.id]);
  return row;
 });
}
