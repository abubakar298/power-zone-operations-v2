import {lockActiveActor} from '../auth/actor-lock.js';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {z} from 'zod';
import {AccountsRepository} from './repository.js';
import {HttpError} from '../http/errors.js';
import {transaction} from '../db/transaction.js';
export const ptEntrySchema=z.object({sourceKind:z.enum(['IPO','Inventory']),sourceId:z.uuid(),sourceVersion:z.number().int().positive(),ptReference:z.string().trim().min(1).max(200),entryDate:z.iso.date(),notes:z.string().trim().max(2000)}).strict();
export async function recordPtEntry(pool:Pool,actor:string,input:z.infer<typeof ptEntrySchema>){
 await new AccountsRepository(pool).access(actor);
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);
  await new AccountsRepository(pool).access(actor,c);
  if(input.sourceKind==='IPO'){
   const source=(await c.query('SELECT i.id FROM internal_purchase_orders i JOIN ipo_accounts_handoffs h ON h.ipo_id=i.id WHERE i.id=$1 FOR SHARE OF i',[input.sourceId])).rows[0];
   if(!source)throw new HttpError(404,'IPO not received by Accounts.');
   // Issued IPOs are immutable documents; each ID identifies version one.
   if(input.sourceVersion!==1)throw new HttpError(409,'Refresh the issued IPO before recording its PT entry.');
  }else{
   const report=(await c.query('SELECT id FROM inventory_reports WHERE id=$1 FOR UPDATE',[input.sourceId])).rows[0];
   if(!report)throw new HttpError(404,'Inventory report not found.');
   const version=(await c.query('SELECT version,stage FROM inventory_report_versions WHERE report_id=$1 ORDER BY version DESC LIMIT 1',[input.sourceId])).rows[0];
   if(version?.stage!=='Sent to Accounts'||version.version!==input.sourceVersion)throw new HttpError(409,'Only the current Inventory-approved document sent to Accounts can be recorded in PT.');
  }
  const old=(await c.query('SELECT *,entry_date::text AS entry_date FROM accounts_pt_entries WHERE source_kind=$1 AND source_id=$2 AND source_version=$3',[input.sourceKind,input.sourceId,input.sourceVersion])).rows[0];
  if(old){if(old.pt_reference===input.ptReference&&String(old.entry_date).slice(0,10)===input.entryDate&&old.notes===input.notes)return old;throw new HttpError(409,'This document version already has a PT entry.');}
  const row=(await c.query('INSERT INTO accounts_pt_entries(id,source_kind,source_id,source_version,pt_reference,entry_date,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(source_kind,source_id,source_version) DO NOTHING RETURNING *,entry_date::text AS entry_date',[randomUUID(),input.sourceKind,input.sourceId,input.sourceVersion,input.ptReference,input.entryDate,input.notes,actor])).rows[0];
  if(!row)throw new HttpError(409,'This document was just recorded in PT. Refresh the workspace.');
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'accounts.pt-entry:'+row.id]);return row;
 });
}
