import {lockActiveActor} from '../auth/actor-lock.js';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Pool,PoolClient} from 'pg';
import {Decimal} from 'decimal.js';
import {z} from 'zod';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';
import {prepareWarehouseSource,warehouseLedgerKey} from './warehouse-source.js';
import {closingEffect,reviewQuantities} from './review-quantities.js';
import type {prepareInventoryReview} from './review-source.js';
import {warehousePosition} from './warehouse-ledger.js';
type ReviewRow=ReturnType<typeof prepareInventoryReview>['cases'][number];
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const warehouseNames:Record<string,string>={Lahore:'Lahore warehouse',Karachi:'Karachi warehouse'};
// These are equivalent count labels only. Lengths/coils/feet/metres are never
// silently converted. The original source label is still retained for display.
const countUnits=new Set(['nos','pcs','piece','pieces','no','no.']);
export class WarehouseSourceRepository{
 constructor(private pool:Pool){}
 async importSource(actor:string,input:{sourceSha256:string;catalogueSha256:string;reviewSourceSha256:string;source:unknown;finalItemIds:string[]}){
  const user=(await this.pool.query('SELECT active,role FROM users WHERE id=$1',[actor])).rows[0];
  if(!user?.active||!['Admin','Management'].includes(user.role))throw new HttpError(403,'Management must import the reviewed warehouse source.');
  sha.parse(input.sourceSha256);sha.parse(input.catalogueSha256);sha.parse(input.reviewSourceSha256);
  const prepared=prepareWarehouseSource(input.source,input.finalItemIds),fingerprint=createHash('sha256').update(JSON.stringify(prepared)).digest('hex');
  return transaction(this.pool,async c=>{
   const freshActor=await lockActiveActor(c,actor);
   if(!['Admin','Management'].includes(freshActor.role))throw new HttpError(403,'Management must import the reviewed warehouse source.');
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.warehouse.source.import',0))");
   const review=(await c.query('SELECT catalogue_sha256 FROM inventory_review_sources WHERE source_sha256=$1',[input.reviewSourceSha256])).rows[0];
   if(!review||review.catalogue_sha256!==input.catalogueSha256)throw new HttpError(409,'The reconciliation and warehouse sources must use the same reviewed item catalogue.');
   const old=(await c.query('SELECT * FROM inventory_warehouse_sources WHERE source_sha256=$1',[input.sourceSha256])).rows[0];
   if(old&&(old.catalogue_sha256!==input.catalogueSha256||old.content_fingerprint!==fingerprint||!isDeepStrictEqual(old.metadata,prepared.meta)))throw new HttpError(409,'Warehouse source fingerprint is already attached to different evidence.');
   const link=(await c.query('SELECT warehouse_source_sha256 FROM inventory_review_warehouse_sources WHERE review_source_sha256=$1',[input.reviewSourceSha256])).rows[0];
   if(link&&link.warehouse_source_sha256!==input.sourceSha256)throw new HttpError(409,'This reconciliation already has a warehouse baseline. Do not replace it.');
   if(!old){
    await c.query('INSERT INTO inventory_warehouse_sources(source_sha256,catalogue_sha256,metadata,content_fingerprint,created_by) VALUES($1,$2,$3,$4,$5)',[input.sourceSha256,input.catalogueSha256,prepared.meta,fingerprint,actor]);
    await c.query(`INSERT INTO inventory_warehouse_source_balances(source_sha256,ledger_key,payload) SELECT $1,r->>'key',r FROM jsonb_array_elements($2::jsonb) r`,[input.sourceSha256,JSON.stringify(prepared.balances)]);
    await c.query(`INSERT INTO inventory_warehouse_source_events(source_sha256,event_id,payload) SELECT $1,r->>'eventId',r FROM jsonb_array_elements($2::jsonb) r`,[input.sourceSha256,JSON.stringify(prepared.events)]);
   }
   if(!link)await c.query('INSERT INTO inventory_review_warehouse_sources(review_source_sha256,warehouse_source_sha256,created_by) VALUES($1,$2,$3)',[input.reviewSourceSha256,input.sourceSha256,actor]);
   return {...prepared.summary,retained:!!old,stockPosted:0};
  });
 }
 /** Called only after the review repository has authorised access to this case. */
 async caseClosing(caseId:string,row:ReviewRow,c:Pool|PoolClient=this.pool){
  const link=(await c.query(`SELECT s.source_sha256,s.metadata FROM inventory_review_cases c
   JOIN inventory_review_warehouse_sources l ON l.review_source_sha256=c.source_sha256
   JOIN inventory_warehouse_sources s ON s.source_sha256=l.warehouse_source_sha256 WHERE c.id=$1`,[caseId])).rows[0];
  const held=(reason:string)=>({available:false as const,reason,postingEnabled:false as const});
  if(!link)return held('Warehouse baseline has not been linked.');
  if(!row.item)return held('Final item identity needs verification.');
  const warehouse=warehouseNames[row.warehouse];if(!warehouse)return held('Warehouse identity needs verification.');
  const unit=countUnits.has(row.unit.toLowerCase())?'piece':row.unit;
  const ledgerKey=warehouseLedgerKey(row.item,warehouse,unit);
  const balance=(await c.query('SELECT payload FROM inventory_warehouse_source_balances WHERE source_sha256=$1 AND ledger_key=$2',[link.source_sha256,ledgerKey])).rows[0]?.payload as ReturnType<typeof prepareWarehouseSource>['balances'][number]|undefined;
  if(!balance)return held('No matching item, warehouse and unit baseline.');
  const projected=reviewQuantities(row),holds=[...projected.calculationHolds];
  if(row.origin!=='warehouse_stock')holds.push('Local purchase or mixed origin needs separate purchase/issue/return reconciliation.');
  const corrections=(await c.query('SELECT case_id,in_delta::text,ledger_revision FROM inventory_warehouse_return_corrections WHERE source_sha256=$1 AND ledger_key=$2 ORDER BY ledger_revision',[link.source_sha256,ledgerKey])).rows;
  const position=await warehousePosition(c,link.source_sha256,ledgerKey);
  const postedTotal=corrections.reduce((sum,r)=>sum.plus(r.in_delta),new Decimal(0));
  const currentClosing=position!.currentClosing;
  const alreadyPosted=corrections.find(r=>r.case_id===caseId);
  const delta=holds.length?null:projected.quantities.creditDifference===null?null:new Decimal(projected.quantities.creditDifference).minus(alreadyPosted?.in_delta??0).toString();
  const effect=delta===null?null:closingEffect({closing:currentClosing,inDelta:delta,outDelta:'0'});
  return {available:true as const,sourceSha256:link.source_sha256,sourceMetadata:link.metadata,ledgerKey,warehouse,unit,balance,
   currentClosing,totalIn:position!.totalIn,totalOut:position!.totalOut,ledgerRevision:position!.ledgerRevision,postedReturnCorrections:postedTotal.toString(),operationalIn:position!.operationalIn,operationalOut:position!.operationalOut,caseCorrectionPosted:!!alreadyPosted,
   suggestedReturnCorrection:effect===null?null:{inDelta:delta!,outDelta:'0',...effect},holds,postingEnabled:false as const,
   basis:'Historical reviewed source; not a new physical count or live stock posting.'};
 }
}
