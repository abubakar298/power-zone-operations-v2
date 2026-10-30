import {lockActiveActor} from '../auth/actor-lock.js';
import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {Decimal} from 'decimal.js';
import {z} from 'zod';
import {HttpError} from '../http/errors.js';
import {transaction} from '../db/transaction.js';

function projectedPosition(sourceSha256:string,ledgerKey:string,baseline:any,correction:{incoming:string;revisions:number},operational:{incoming:string;outgoing:string;revisions:number}){
 const credited=new Decimal(correction.incoming).plus(operational.incoming),out=new Decimal(operational.outgoing);
 const closing=baseline.calculatedClosing===null?null:new Decimal(baseline.calculatedClosing).plus(credited).minus(out).toString();
 return {sourceSha256,ledgerKey,baseline,currentClosing:closing,ledgerRevision:correction.revisions+operational.revisions,
  historicalReturnCorrections:new Decimal(correction.incoming).toString(),operationalIn:new Decimal(operational.incoming).toString(),operationalOut:new Decimal(operational.outgoing).toString(),
  totalIn:new Decimal(baseline.eventIn).plus(credited).toString(),totalOut:new Decimal(baseline.eventOut).plus(out).toString()};
}

/** A reviewed baseline plus append-only corrections and new physical movements.
 * Historical evidence remains immutable; IRR/site usage is not warehouse OUT. */
export async function warehousePosition(c:Pool|PoolClient,sourceSha256:string,ledgerKey:string,lock=false){
 const baseline=(await c.query('SELECT payload FROM inventory_warehouse_source_balances WHERE source_sha256=$1 AND ledger_key=$2'+(lock?' FOR UPDATE':''),[sourceSha256,ledgerKey])).rows[0]?.payload;
 if(!baseline)return null;
 const correction=(await c.query('SELECT coalesce(sum(in_delta),0)::text incoming,count(*)::int revisions FROM inventory_warehouse_return_corrections WHERE source_sha256=$1 AND ledger_key=$2',[sourceSha256,ledgerKey])).rows[0];
 const operational=(await c.query('SELECT coalesce(sum(in_delta),0)::text incoming,coalesce(sum(out_delta),0)::text outgoing,count(*)::int revisions FROM inventory_warehouse_operational_movements WHERE source_sha256=$1 AND ledger_key=$2',[sourceSha256,ledgerKey])).rows[0];
 return projectedPosition(sourceSha256,ledgerKey,baseline,correction,operational);
}

/** Batched read projection. Posting still locks and rechecks individual rows. */
export async function warehousePositions(c:Pool|PoolClient,sourceSha256:string,warehouse?:string){
 const rows=(await c.query(`WITH corrections AS(SELECT ledger_key,sum(in_delta)::text incoming,count(*)::int revisions FROM inventory_warehouse_return_corrections WHERE source_sha256=$1 GROUP BY ledger_key),
 operational AS(SELECT ledger_key,sum(in_delta)::text incoming,sum(out_delta)::text outgoing,count(*)::int revisions FROM inventory_warehouse_operational_movements WHERE source_sha256=$1 GROUP BY ledger_key)
 SELECT b.ledger_key,b.payload,coalesce(c.incoming,'0') correction_in,coalesce(c.revisions,0) correction_revisions,coalesce(o.incoming,'0') operational_in,coalesce(o.outgoing,'0') operational_out,coalesce(o.revisions,0) operational_revisions
 FROM inventory_warehouse_source_balances b LEFT JOIN corrections c USING(ledger_key) LEFT JOIN operational o USING(ledger_key) WHERE b.source_sha256=$1 AND ($2::text IS NULL OR b.payload->>'warehouse'=$2) ORDER BY b.ledger_key`,[sourceSha256,warehouse??null])).rows;
 return rows.map(r=>projectedPosition(sourceSha256,r.ledger_key,r.payload,{incoming:r.correction_in,revisions:r.correction_revisions},{incoming:r.operational_in,outgoing:r.operational_out,revisions:r.operational_revisions}));
}

export const warehouseAuthorityInputSchema=z.object({warehouse:z.string().trim().min(1).max(200),version:z.number().int().nonnegative(),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),state:z.enum(['active','suspended']),reason:z.string().trim().min(3).max(2000),requestKey:z.uuid()}).strict();
type AuthorityInput=z.infer<typeof warehouseAuthorityInputSchema>;
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class WarehouseAuthorityRepository{
 constructor(private pool:Pool){}
 /** Operator boundary: activating a source is explicit and Management-only.
  * A later baseline cannot silently discard movements or prior corrections. */
 async command(actor:string,raw:AuthorityInput){
  const input=warehouseAuthorityInputSchema.parse(raw);
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   const user=(await c.query('SELECT role,active FROM users WHERE id=$1',[actor])).rows[0];
   if(!user?.active||!['Admin','Management'].includes(user.role))throw new HttpError(403,'Management must verify the warehouse stock baseline.');
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.warehouse.governance',0))");
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.warehouse.authority.'||$1,0))",[input.warehouse]);
   const replay=(await c.query('SELECT warehouse,version,state,request_fingerprint,created_by FROM inventory_warehouse_authority_versions WHERE request_key=$1',[input.requestKey])).rows[0];
   if(replay){if(replay.created_by!==actor||replay.request_fingerprint!==fingerprint(input))throw new HttpError(409,'This request belongs to another baseline decision.');return {warehouse:replay.warehouse,version:replay.version,state:replay.state};}
   const old=(await c.query('SELECT * FROM inventory_warehouse_authority_current WHERE warehouse=$1',[input.warehouse])).rows[0];
   if((old?.version??0)!==input.version)throw new HttpError(409,'The warehouse baseline decision changed. Refresh before continuing.');
   if(old&&old.source_sha256!==input.sourceSha256)throw new HttpError(409,'A warehouse baseline cannot be replaced here. Reconcile existing history before adopting another source.');
   if(input.state==='active'&&(await c.query('SELECT 1 FROM stock_on_hand_entries e JOIN inventory_warehouse_sources s ON s.source_sha256=$1 WHERE e.created_at>s.created_at AND NOT EXISTS(SELECT 1 FROM inventory_material_purchase_lines l WHERE l.stock_entry_id=e.id) LIMIT 1',[input.sourceSha256])).rowCount)
    throw new HttpError(409,'Reconcile newer global stock counts or receipts before activating this warehouse baseline.');
   const exists=(await c.query("SELECT 1 FROM inventory_warehouse_source_balances WHERE source_sha256=$1 AND payload->>'warehouse'=$2 LIMIT 1",[input.sourceSha256,input.warehouse])).rowCount;
   if(!exists)throw new HttpError(422,'This source has no reviewed balance for the selected warehouse.');
   await c.query(`INSERT INTO inventory_warehouse_authority_versions(warehouse,version,source_sha256,state,reason,request_key,request_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[input.warehouse,input.version+1,input.sourceSha256,input.state,input.reason,input.requestKey,fingerprint(input),actor]);
   return {warehouse:input.warehouse,version:input.version+1,state:input.state};
  });
 }
}

/** A physical delta never supplies an absent historical opening balance. */
export function nextWarehouseClosing(before:string|null,quantity:string,direction:1|-1){return before===null?null:new Decimal(before).plus(new Decimal(quantity).mul(direction)).toString();}
