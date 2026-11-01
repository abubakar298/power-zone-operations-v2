import {createHash} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {z} from 'zod';
import type {Pool} from 'pg';
import {transaction} from '../db/transaction.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {requireQcMaterialSite} from '../inventory/qc-material-access.js';
import {HttpError} from '../http/errors.js';
export const localPurchasesSchema=z.object({version:z.number().int().nonnegative(),requestKey:z.uuid(),items:z.array(z.object({key:z.uuid(),itemId:z.string().trim().min(1).max(160),description:z.string().trim().min(1).max(1000),quantity:z.string().regex(/^\d{1,14}(?:\.\d{1,6})?$/).refine(v=>new Decimal(v).gt(0)).transform(v=>new Decimal(v).toString())}).strict()).max(200)}).strict();
/** Caller authorizes QC for site read, or Accounts for the separate cost-entry projection. */
export async function readLocalPurchases(pool:Pool,siteId:string){
 const saved=(await pool.query('SELECT version,snapshot,created_at FROM operations_site_local_purchase_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[siteId])).rows[0];
 return {siteId,version:saved?.version??0,items:saved?.snapshot.items??[],recordedAt:saved?.created_at??null,destination:'Accounts',stockPosting:false};
}
export async function saveLocalPurchases(pool:Pool,actor:string,siteId:string,raw:unknown){
 const parsed=localPurchasesSchema.safeParse(raw);if(!parsed.success)throw new HttpError(422,'Enter an item ID, description and positive quantity for every local purchase.');
 const input=parsed.data,fingerprint=createHash('sha256').update(JSON.stringify([siteId,input])).digest('hex');
 if(new Set(input.items.map(i=>i.key)).size!==input.items.length||new Set(input.items.map(i=>i.itemId.toUpperCase())).size!==input.items.length)throw new HttpError(422,'Record each local-purchase item ID once.');
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);await requireQcMaterialSite(actor,siteId,c,true);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['qc.local-purchases.request.'+input.requestKey]);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['qc.local-purchases.'+siteId]);
  const replay=(await c.query('SELECT site_id,version,request_fingerprint,created_by FROM operations_site_local_purchase_versions WHERE request_key=$1',[input.requestKey])).rows[0];
  if(replay){if(replay.site_id!==siteId||replay.created_by!==actor||replay.request_fingerprint!==fingerprint)throw new HttpError(409,'This request belongs to another purchase record.');return {version:replay.version,stockPosting:false};}
  const previous=(await c.query('SELECT version FROM operations_site_local_purchase_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[siteId])).rows[0];
  if((previous?.version??0)!==input.version)throw new HttpError(409,'Local purchases changed. Refresh before saving.');
  await c.query('INSERT INTO operations_site_local_purchase_versions(site_id,version,snapshot,request_key,request_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6)',[siteId,input.version+1,{items:input.items,destination:'Accounts',stockPosting:false},input.requestKey,fingerprint,actor]);
  return {version:input.version+1,stockPosting:false};
 });
}
export {requireQcMaterialSite as requireLocalPurchaseSite};
