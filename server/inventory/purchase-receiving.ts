import {lockActiveActor} from '../auth/actor-lock.js';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {Decimal} from 'decimal.js';
import {z} from 'zod';
import {HttpError} from '../http/errors.js';
import {transaction} from '../db/transaction.js';
import {sameUnit} from '../../shared/stock-units.js';
import {warehousePosition} from './warehouse-ledger.js';
import {requireWarehouseAccess,lockWarehouseAuthority,warehouseNumber} from './warehouse-access.js';
const quantity=z.string().regex(/^\d{1,14}(?:\.\d{1,6})?$/).refine(v=>new Decimal(v).gt(0),'Enter a positive received quantity.').transform(v=>new Decimal(v).toString());
export const purchaseReceiptInputSchema=z.object({requestId:z.uuid(),requestKey:z.uuid(),warehouse:z.string().trim().min(1).max(200),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),authorityVersion:z.number().int().positive(),evidenceId:z.uuid(),reason:z.string().trim().min(3).max(2000),lines:z.array(z.object({itemKey:z.string().trim().min(1).max(200),itemId:z.string().trim().min(1).max(200),unit:z.string().trim().min(1).max(40),quantity,ledgerRevision:z.number().int().nonnegative()}).strict()).min(1).max(200)}).strict();
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
type Db=Pool|PoolClient;

/** One new physical purchase receipt, linked to its original commercial line.
 * Fulfilment and warehouse IN commit together; historical receipts are not replayed. */
export class PurchaseReceivingRepository{
 constructor(private pool:Pool){}
 private async candidates(c:Db,itemKey:string){return (await c.query(`SELECT item_id,payload->>'stockDescription' description,payload->'stockUnits' units FROM inventory_catalogue_final_current WHERE payload->>'finalStockId'='true' AND (item_id=$1 OR rate_key=$1 OR item_id IN(SELECT item_id FROM inventory_item_aliases_current WHERE alias=$1)) ORDER BY item_id`,[itemKey])).rows;}
 async intake(actor:string,requestId:string,warehouse:string){
  await requireWarehouseAccess(actor,warehouse,this.pool);
  const request=(await this.pool.query('SELECT id,number,status,vendor,delivery_to FROM purchase_requests WHERE id=$1',[requestId])).rows[0];if(!request)throw new HttpError(404,'Purchase request not found.');
  const authority=(await this.pool.query('SELECT source_sha256,version,state FROM inventory_warehouse_authority_current WHERE warehouse=$1',[warehouse])).rows[0]??null;
  const lines=(await this.pool.query(`SELECT l.item_key,l.quantity::text ordered,l.unit,coalesce((SELECT sum(e.quantity) FROM stock_on_hand_entries e WHERE e.request_id=l.request_id AND e.item_key=l.item_key AND e.kind='receipt'),0)::text received FROM purchase_request_lines l WHERE request_id=$1 ORDER BY item_key`,[requestId])).rows;
  const result=[];for(const line of lines){const candidates=await this.candidates(this.pool,line.item_key);result.push({...line,due:Decimal.max(0,new Decimal(line.ordered).minus(line.received)).toString(),candidates});}
  return {request,warehouse,authority,lines:result};
 }
 async receipt(actor:string,id:string){const row=(await this.pool.query('SELECT id,number,warehouse,snapshot,created_at FROM inventory_material_purchase_receipts WHERE id=$1',[id])).rows[0];if(!row)throw new HttpError(404,'Purchase warehouse receipt not found.');await requireWarehouseAccess(actor,row.warehouse,this.pool,true);return row;}
 async receive(actor:string,raw:z.infer<typeof purchaseReceiptInputSchema>){
  const input=purchaseReceiptInputSchema.parse(raw);
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.purchase.receipt.request.'||$1,0))",[input.requestKey]);
   const replay=(await c.query('SELECT id,number,warehouse,request_fingerprint,verified_by FROM inventory_material_purchase_receipts WHERE request_key=$1',[input.requestKey])).rows[0];
   if(replay){await requireWarehouseAccess(actor,replay.warehouse,c);if(replay.verified_by!==actor||replay.request_fingerprint!==hash(input))throw new HttpError(409,'This request belongs to another purchase receipt.');return {id:replay.id,number:replay.number,stockPosted:true};}
   await requireWarehouseAccess(actor,input.warehouse,c);
   const order=(await c.query('SELECT id,number,status FROM purchase_requests WHERE id=$1 FOR UPDATE',[input.requestId])).rows[0];if(!order)throw new HttpError(404,'Purchase request not found.');if(order.status!=='ordered')throw new HttpError(409,'Only an ordered purchase can receive a new physical warehouse receipt.');
   await lockWarehouseAuthority(c,input.warehouse,input.sourceSha256,input.authorityVersion);
   const evidence=(await c.query('SELECT id,warehouse,sha256 FROM inventory_material_evidence WHERE id=$1',[input.evidenceId])).rows[0];if(!evidence||evidence.warehouse!==input.warehouse)throw new HttpError(422,'Upload the signed receiving copy for this warehouse.');
   if((await c.query('SELECT 1 FROM inventory_material_purchase_receipts WHERE request_id=$1 AND evidence_id=$2',[input.requestId,input.evidenceId])).rowCount)throw new HttpError(409,'This purchase receipt evidence has already been credited.');
   if(new Set(input.lines.map(r=>r.itemKey)).size!==input.lines.length)throw new HttpError(422,'Record each purchase line once in this receipt.');
   const purchaseLines=(await c.query(`SELECT l.item_key,l.quantity::text ordered,l.unit,coalesce((SELECT sum(e.quantity) FROM stock_on_hand_entries e WHERE e.request_id=l.request_id AND e.item_key=l.item_key AND e.kind='receipt'),0)::text received FROM purchase_request_lines l WHERE request_id=$1 ORDER BY item_key`,[input.requestId])).rows;
   const prepared:{request:z.infer<typeof purchaseReceiptInputSchema>['lines'][number];original:{unit:string};ledgerKey:string;description:string}[]=[];
   for(const request of input.lines){
    const original=purchaseLines.find(r=>r.item_key===request.itemKey);if(!original)throw new HttpError(422,'The selected item is not on this purchase order.');
    if(new Decimal(request.quantity).gt(new Decimal(original.ordered).minus(original.received)))throw new HttpError(422,'The received quantity exceeds what remains due. Obtain a separate purchase or approved quantity correction for extra goods.');
    const candidates=await this.candidates(c,request.itemKey);if(!candidates.some(r=>r.item_id===request.itemId))throw new HttpError(422,'Select a final stock ID explicitly linked to this purchase item.');
    if(!sameUnit(original.unit,request.unit))throw new HttpError(422,'The purchase and stock units require a reviewed conversion. Quantities are not automatically changed between watts, pieces, coils or lengths.');
    const balances=(await c.query("SELECT ledger_key,payload FROM inventory_warehouse_source_balances WHERE source_sha256=$1 AND payload->>'warehouse'=$2 AND payload->>'itemId'=$3 AND payload->>'unit'=$4",[input.sourceSha256,input.warehouse,request.itemId,request.unit])).rows;
    if(balances.length!==1)throw new HttpError(409,'Verify the opening balance and recorded unit for this warehouse item before receiving stock. Do not assume zero.');
    prepared.push({request,original,ledgerKey:balances[0].ledger_key,description:candidates.find(r=>r.item_id===request.itemId)?.description??request.itemId});
   }
   const positions=new Map<string,NonNullable<Awaited<ReturnType<typeof warehousePosition>>>>();
   for(const key of [...new Set(prepared.map(r=>r.ledgerKey))].sort()){
    const p=await warehousePosition(c,input.sourceSha256,key,true);if(!p||p.currentClosing===null)throw new HttpError(409,'Verify this warehouse closing balance before receiving stock.');
    if(prepared.some(r=>r.ledgerKey===key&&r.request.ledgerRevision!==p.ledgerRevision))throw new HttpError(409,'This warehouse balance changed. Refresh before receiving.');positions.set(key,p);
   }
   const id=randomUUID(),number=await warehouseNumber(c,'IGP',id),snapshot={warehouse:input.warehouse,purchaseRequest:{id:order.id,number:order.number},evidence:{id:evidence.id,sha256:evidence.sha256},reason:input.reason,lines:prepared.map(p=>({itemKey:p.request.itemKey,itemId:p.request.itemId,description:p.description,unit:p.request.unit,quantity:p.request.quantity})),stockPosting:true};
   await c.query('INSERT INTO inventory_material_purchase_receipts(id,number,request_id,warehouse,source_sha256,evidence_id,reason,snapshot,request_key,request_fingerprint,verified_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,number,input.requestId,input.warehouse,input.sourceSha256,input.evidenceId,input.reason,snapshot,input.requestKey,hash(input),actor]);
   for(const p of prepared){
    const entry=(await c.query("INSERT INTO stock_on_hand_entries(item_key,kind,quantity,unit,request_id,note,created_by) VALUES($1,'receipt',$2,$3,$4,$5,$6) RETURNING id",[p.request.itemKey,p.request.quantity,p.original.unit,input.requestId,input.reason,actor])).rows[0].id,lineId=randomUUID();
    await c.query('INSERT INTO inventory_material_purchase_lines(id,receipt_id,item_key,item_id,unit,quantity,source_sha256,ledger_key,stock_entry_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[lineId,id,p.request.itemKey,p.request.itemId,p.request.unit,p.request.quantity,input.sourceSha256,p.ledgerKey,entry]);
    const position=positions.get(p.ledgerKey)!,before=position.currentClosing!,after=new Decimal(before).plus(p.request.quantity).toString();
    await c.query("INSERT INTO inventory_warehouse_operational_movements(id,source_sha256,ledger_key,ledger_revision,kind,purchase_receipt_id,purchase_line_id,in_delta,out_delta,closing_before,closing_after,created_by) VALUES($1,$2,$3,$4,'purchase-in',$5,$6,$7,0,$8,$9,$10)",[randomUUID(),input.sourceSha256,p.ledgerKey,position.ledgerRevision+1,id,lineId,p.request.quantity,before,after,actor]);position.currentClosing=after;position.ledgerRevision++;
   }
   const complete=purchaseLines.every(line=>new Decimal(line.received).plus(prepared.find(p=>p.request.itemKey===line.item_key)?.request.quantity??0).gte(line.ordered));
   const status=complete?'received':'ordered';
   if(complete)await c.query("UPDATE purchase_requests SET status='received',received_by=$2,received_at=now(),updated_at=now() WHERE id=$1",[input.requestId,actor]);else await c.query('UPDATE purchase_requests SET updated_at=now() WHERE id=$1',[input.requestId]);
   const event=complete?'received':'part_received';await c.query('INSERT INTO purchase_request_events(request_id,kind,from_status,to_status,note,changes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[input.requestId,event,'ordered',status,input.reason,{warehouse:input.warehouse,receiptId:id,number,arrived:snapshot.lines},actor]);await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`procurement.${event}:${input.requestId}`]);
   return {id,number,stockPosted:true};
  });
 }
}
