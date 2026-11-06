import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {Decimal} from 'decimal.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';
const name=z.string().trim().min(1).max(200);
export const minimumStockInput=z.object({warehouse:name,itemId:name,unit:z.string().trim().min(1).max(40),minimum:z.string().regex(/^\d{1,14}(?:\.\d{1,6})?$/),version:z.number().int().nonnegative(),requestKey:z.uuid(),reason:z.string().trim().min(3).max(2000)}).strict();
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class MinimumStockRepository{
 constructor(private pool:Pool){}
 private async access(c:Pool|PoolClient,actor:string,warehouse:string){
  const u=(await c.query('SELECT active,role FROM users WHERE id=$1',[actor])).rows[0];
  if(!u?.active)throw new HttpError(401,'Your access has ended.');
  if(!['Admin','Management'].includes(u.role)&&!(u.role==='Inventory'&&(await c.query("SELECT 1 FROM inventory_material_access WHERE user_id=$1 AND warehouse=$2 AND capability='dispatcher'",[actor,warehouse])).rowCount))throw new HttpError(403,'Minimum stock settings require material-issuance permission for this warehouse.');
 }
 private async catalogue(c:Pool|PoolClient,warehouse:string){
  const source=(await c.query("SELECT source_sha256 FROM inventory_warehouse_sources ORDER BY (coalesce(metadata->>'canonicalIds','') ~ '^[1-9][0-9]*$') DESC,created_at DESC,source_sha256 LIMIT 1")).rows[0];
  if(!source)throw new HttpError(409,'A reviewed warehouse catalogue is required before setting minimum stock.');
  const rows=(await c.query("SELECT payload->>'itemId' AS item_id,payload->>'unit' AS unit FROM inventory_warehouse_source_balances WHERE source_sha256=$1 AND payload->>'warehouse'=$2",[source.source_sha256,warehouse])).rows;
  if(!rows.length)throw new HttpError(422,'Select a warehouse from the reviewed stock catalogue.');
  return {source:source.source_sha256 as string,rows};
 }
 async read(actor:string,rawWarehouse:unknown){
  const warehouse=name.parse(rawWarehouse);await this.access(this.pool,actor,warehouse);const catalogue=await this.catalogue(this.pool,warehouse);
  const settings=(await this.pool.query('SELECT DISTINCT ON(item_id,unit) item_id AS "itemId",unit,minimum::text AS minimum,version FROM inventory_minimum_stock_versions WHERE warehouse=$1 ORDER BY item_id,unit,version DESC',[warehouse])).rows.map(r=>({...r,minimum:new Decimal(r.minimum).toString()}));
  return {warehouse,settings,sourceSha256:catalogue.source,stockPosting:false as const};
 }
 async save(actor:string,raw:unknown){
  const input=minimumStockInput.parse(raw),requestSha=hash(input);
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);await this.access(c,actor,input.warehouse);
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.minimum-stock:'||$1,0))",[JSON.stringify([input.warehouse,input.itemId,input.unit])]);
   const replay=(await c.query('SELECT *,minimum::text AS amount FROM inventory_minimum_stock_versions WHERE request_key=$1',[input.requestKey])).rows[0];
   if(replay){if(replay.created_by!==actor||replay.request_sha256!==requestSha)throw new HttpError(409,'This request key belongs to another minimum-stock decision.');return {warehouse:replay.warehouse,itemId:replay.item_id,unit:replay.unit,minimum:new Decimal(replay.amount).toString(),version:replay.version,stockPosting:false as const};}
   const catalogue=await this.catalogue(c,input.warehouse);if(!catalogue.rows.some(r=>r.item_id===input.itemId&&r.unit===input.unit))throw new HttpError(422,'Select an exact item ID and unit from this warehouse catalogue.');
   const current=(await c.query('SELECT COALESCE(max(version),0)::int AS version FROM inventory_minimum_stock_versions WHERE warehouse=$1 AND item_id=$2 AND unit=$3',[input.warehouse,input.itemId,input.unit])).rows[0].version;
   if(current!==input.version)throw new HttpError(409,'The minimum stock setting changed. Refresh before saving.');
   const minimum=new Decimal(input.minimum).toString(),version=current+1;
   await c.query('INSERT INTO inventory_minimum_stock_versions(warehouse,item_id,unit,version,minimum,source_sha256,reason,request_key,request_sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[input.warehouse,input.itemId,input.unit,version,minimum,catalogue.source,input.reason,input.requestKey,requestSha,actor]);
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'inventory.minimum-stock:'+requestSha]);
   return {warehouse:input.warehouse,itemId:input.itemId,unit:input.unit,minimum,version,stockPosting:false as const};
  });
 }
}
