import {deferDispatch,dispatchPosted} from './signed-dispatch.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {Decimal} from 'decimal.js';
import {z} from 'zod';
import {HttpError} from '../http/errors.js';
import {transaction} from '../db/transaction.js';
import {sameUnit} from '../../shared/stock-units.js';
import {warehousePosition,warehousePositions} from './warehouse-ledger.js';
import {requireWarehouseAccess,lockWarehouseAuthority,warehouseNumber} from './warehouse-access.js';
const quantity=z.string().regex(/^\d{1,14}(?:\.\d{1,6})?$/).refine(v=>new Decimal(v).gt(0),'Enter a positive quantity.').transform(v=>new Decimal(v).toString());
const endpoint=z.object({warehouse:z.string().trim().min(1).max(200),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),authorityVersion:z.number().int().positive()}).strict();
export const warehouseTransferIssueSchema=z.object({requestKey:z.uuid(),source:endpoint,destination:endpoint,reason:z.string().trim().min(3).max(2000),transport:z.object({vehicle:z.string().trim().max(100),driver:z.string().trim().max(200),reference:z.string().trim().max(200)}).strict(),lines:z.array(z.object({lineKey:z.uuid(),itemId:z.string().trim().min(1).max(200),sourceLedgerKey:z.string().regex(/^[a-f0-9]{64}$/),destinationLedgerKey:z.string().regex(/^[a-f0-9]{64}$/),quantity,sourceLedgerRevision:z.number().int().nonnegative(),destinationLedgerRevision:z.number().int().nonnegative()}).strict()).min(1).max(200)}).strict();
export const warehouseTransferReceiptSchema=z.object({transferId:z.uuid(),requestKey:z.uuid(),destinationSourceSha256:z.string().regex(/^[a-f0-9]{64}$/),authorityVersion:z.number().int().positive(),evidenceId:z.uuid(),reason:z.string().trim().min(3).max(2000),lines:z.array(z.object({lineKey:z.uuid(),quantity,ledgerRevision:z.number().int().nonnegative()}).strict()).min(1).max(200)}).strict();
type Db=Pool|PoolClient;
type Position=NonNullable<Awaited<ReturnType<typeof warehousePosition>>>;
const fingerprint=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const identity=(source:string,key:string)=>source+':'+key;
async function postingScope(actor:string,warehouse:string,c:PoolClient){
 await requireWarehouseAccess(actor,warehouse,c);
 const u=(await c.query('SELECT role,active FROM users WHERE id=$1 FOR SHARE',[actor])).rows[0];
 if(!u?.active)throw new HttpError(401,'Your access has ended.');
 if(!['Admin','Management'].includes(u.role)&&!(u.role==='Inventory'&&(await c.query("SELECT 1 FROM inventory_material_access WHERE user_id=$1 AND warehouse=$2 AND capability='dispatcher' FOR SHARE",[actor,warehouse])).rowCount))throw new HttpError(403,'Only the assigned Inventory dispatcher can post warehouse stock.');
}
/** Same shared reference registry/lock as warehouseNumber; TRF is unrestricted text in schema032. */
async function transferNumber(c:PoolClient,id:string){
 await c.query('SELECT pg_advisory_xact_lock(742019040)');
 const year=(await c.query("SELECT extract(year FROM now() AT TIME ZONE 'Asia/Karachi')::integer AS calendar_year")).rows[0].calendar_year;
 const sequence=(await c.query("INSERT INTO document_sequences(document_type,calendar_year,last_value) VALUES('TRF',$1,1) ON CONFLICT(document_type,calendar_year) DO UPDATE SET last_value=document_sequences.last_value+1 RETURNING last_value",[year])).rows[0].last_value;
 const number=`CPZ-TRF-${String(year).slice(-2)}-${String(sequence).padStart(4,'0')}`;
 await c.query("INSERT INTO document_reference_roots(document_type,family_id,reference) VALUES('TRF',$1,$2)",[id,number]);return number;
}
async function finalItem(c:Db,id:string){const row=(await c.query("SELECT item_id,payload FROM inventory_catalogue_final_current WHERE item_id=$1 AND payload->>'finalStockId'='true'",[id])).rows[0];if(!row)throw new HttpError(422,'Select the exact final merged stock ID.');return row;}
function reviewed(p:Position|null,warehouse:string,itemId:string){if(!p||p.baseline.warehouse!==warehouse||p.baseline.itemId!==itemId||p.currentClosing===null||new Decimal(p.currentClosing).lt(0))throw new HttpError(409,'Verify the existing opening, final item identity, unit and closing for both warehouses. Do not assume zero or create a destination balance.');return p;}
/** Immutable physical transfer. Printing/reading never receives destination stock. */
export class WarehouseTransferRepository{
 constructor(private pool:Pool){}
 /** Source dispatcher selects reviewed destination identities without reading its stock totals. */
 async intake(actor:string,sourceWarehouse:string,destinationWarehouse:string){
  await requireWarehouseAccess(actor,sourceWarehouse,this.pool);
  if(sourceWarehouse===destinationWarehouse)throw new HttpError(422,'Select two different warehouses.');
  const authority=async(warehouse:string)=>(await this.pool.query('SELECT warehouse,source_sha256,version,state FROM inventory_warehouse_authority_current WHERE warehouse=$1',[warehouse])).rows[0]??null;
  const source=await authority(sourceWarehouse),destination=await authority(destinationWarehouse);
  const from=source?await warehousePositions(this.pool,source.source_sha256,sourceWarehouse):[],to=destination?await warehousePositions(this.pool,destination.source_sha256,destinationWarehouse):[];
  const finalIds=new Set((await this.pool.query("SELECT item_id FROM inventory_catalogue_final_current WHERE payload->>'finalStockId'='true'")).rows.map(r=>r.item_id));
  const projected=(p:Position)=>({ledgerKey:p.ledgerKey,itemId:p.baseline.itemId,description:p.baseline.description,unit:p.baseline.unit,ledgerRevision:p.ledgerRevision,reviewedClosing:p.currentClosing!==null&&new Decimal(p.currentClosing).gte(0)});
  return {source:{warehouse:sourceWarehouse,authority:source,positions:from.filter(p=>finalIds.has(p.baseline.itemId)).map(p=>({...projected(p),currentClosing:p.currentClosing}))},destination:{warehouse:destinationWarehouse,authority:destination,positions:to.filter(p=>finalIds.has(p.baseline.itemId)).map(projected)}};
 }
 private async row(actor:string,id:string,c:Db=this.pool,lock=false){
  const row=(await c.query('SELECT * FROM inventory_warehouse_transfers WHERE id=$1'+(lock?' FOR UPDATE':''),[id])).rows[0];if(!row)throw new HttpError(404,'Warehouse transfer not found.');
  try{await requireWarehouseAccess(actor,row.source_warehouse,c,true);}catch(error){if(!(error instanceof HttpError)||error.status!==403)throw error;await requireWarehouseAccess(actor,row.destination_warehouse,c,true);}return row;
 }
 async list(actor:string){
  const u=(await this.pool.query('SELECT role,active FROM users WHERE id=$1',[actor])).rows[0];if(!u?.active)throw new HttpError(401,'Your access has ended.');
  const owner=['Admin','Management'].includes(u.role),warehouses=u.role==='Inventory'?(await this.pool.query("SELECT DISTINCT warehouse FROM inventory_material_access WHERE user_id=$1 AND capability IN('dispatcher','storekeeper')",[actor])).rows.map(r=>r.warehouse):[];
  if(!owner&&!warehouses.length)throw new HttpError(403,'Warehouse document access is required.');
  return (await this.pool.query('SELECT id,number,source_warehouse,destination_warehouse,created_at FROM inventory_warehouse_transfers WHERE $1 OR source_warehouse=ANY($2::text[]) OR destination_warehouse=ANY($2::text[]) ORDER BY created_at DESC,id',[owner,warehouses])).rows;
 }
 async detail(actor:string,id:string){const row=await this.row(actor,id);row.stockPosted=await dispatchPosted(this.pool,'transfer-out',id);const lines=(await this.pool.query(`SELECT l.line_key,l.item_id,l.unit,l.destination_unit,l.description,l.quantity::text issued,coalesce((SELECT sum(r.quantity) FROM inventory_warehouse_transfer_receipt_lines r WHERE r.transfer_id=l.transfer_id AND r.line_key=l.line_key),0)::text received FROM inventory_warehouse_transfer_lines l WHERE transfer_id=$1 ORDER BY line_key`,[id])).rows;const receipts=(await this.pool.query('SELECT id,number,created_at,evidence_id FROM inventory_warehouse_transfer_receipts WHERE transfer_id=$1 ORDER BY created_at,id',[id])).rows;return {id:row.id,number:row.number,sourceWarehouse:row.source_warehouse,destinationWarehouse:row.destination_warehouse,stockPosted:await dispatchPosted(this.pool,'transfer-out',id),snapshot:{...row.snapshot,stockPosting:await dispatchPosted(this.pool,'transfer-out',id)},createdAt:row.created_at,lines:lines.map(l=>({...l,issued:new Decimal(l.issued).toString(),received:new Decimal(l.received).toString(),inTransit:row.snapshot.requiresSignedGate&&!(row.stockPosted??false)?'0':new Decimal(l.issued).minus(l.received).toString()})),receipts,cancellation:'Issued transfer is immutable. Resolve discrepancies through a separately authorised physical return or reconciliation.'};}
 async receipt(actor:string,id:string){const row=(await this.pool.query('SELECT r.id,r.number,r.transfer_id,r.snapshot,r.created_at,t.destination_warehouse warehouse FROM inventory_warehouse_transfer_receipts r JOIN inventory_warehouse_transfers t ON t.id=r.transfer_id WHERE r.id=$1',[id])).rows[0];if(!row)throw new HttpError(404,'Transfer receipt not found.');await requireWarehouseAccess(actor,row.warehouse,this.pool,true);return row;}
 async issue(actor:string,raw:z.infer<typeof warehouseTransferIssueSchema>){const input=warehouseTransferIssueSchema.parse(raw);return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.transfer.issue.request.'||$1,0))",[input.requestKey]);
  const replay=(await c.query('SELECT * FROM inventory_warehouse_transfers WHERE request_key=$1',[input.requestKey])).rows[0];if(replay){await postingScope(actor,replay.source_warehouse,c);if(replay.created_by!==actor||replay.request_fingerprint!==fingerprint(input))throw new HttpError(409,'This request belongs to another transfer.');return {id:replay.id,number:replay.number,stockPosted:await dispatchPosted(c,'transfer-out',replay.id)};}
  if(input.source.warehouse===input.destination.warehouse)throw new HttpError(422,'Select two different warehouses.');await postingScope(actor,input.source.warehouse,c);
  for(const side of [input.source,input.destination].sort((a,b)=>a.warehouse.localeCompare(b.warehouse)))await lockWarehouseAuthority(c,side.warehouse,side.sourceSha256,side.authorityVersion);
  for(const key of ['lineKey','sourceLedgerKey','destinationLedgerKey'] as const)if(new Set(input.lines.map(l=>l[key])).size!==input.lines.length)throw new HttpError(422,'Record each transferred item position once.');
  const requests=new Map<string,{source:string;key:string}>();for(const line of input.lines){requests.set(identity(input.source.sourceSha256,line.sourceLedgerKey),{source:input.source.sourceSha256,key:line.sourceLedgerKey});requests.set(identity(input.destination.sourceSha256,line.destinationLedgerKey),{source:input.destination.sourceSha256,key:line.destinationLedgerKey});}
  const positions=new Map<string,Position|null>();for(const [key,r]of [...requests].sort(([a],[b])=>a.localeCompare(b)))positions.set(key,await warehousePosition(c,r.source,r.key,true));
  const lines=[];for(const line of input.lines){
   await finalItem(c,line.itemId);const from=reviewed(positions.get(identity(input.source.sourceSha256,line.sourceLedgerKey))??null,input.source.warehouse,line.itemId),to=reviewed(positions.get(identity(input.destination.sourceSha256,line.destinationLedgerKey))??null,input.destination.warehouse,line.itemId);
   if(!sameUnit(from.baseline.unit,to.baseline.unit))throw new HttpError(422,'Source and destination units need a reviewed conversion. No pieces, coils, lengths or metres are converted here.');
   if(sameUnit(from.baseline.unit,'No.')&&!new Decimal(line.quantity).isInteger())throw new HttpError(422,'Whole-item stock must be transferred in whole quantities.');
   if(from.ledgerRevision!==line.sourceLedgerRevision||to.ledgerRevision!==line.destinationLedgerRevision)throw new HttpError(409,'A warehouse balance changed. Refresh before issuing the transfer.');
   if(new Decimal(from.currentClosing!).lt(line.quantity))throw new HttpError(409,'Verified source warehouse stock is insufficient.');
   lines.push({...line,unit:from.baseline.unit,destinationUnit:to.baseline.unit,description:from.baseline.description||line.itemId});
  }
  const id=randomUUID(),number=await transferNumber(c,id),snapshot={sourceWarehouse:input.source.warehouse,destinationWarehouse:input.destination.warehouse,source:input.source,destination:input.destination,reason:input.reason,transport:input.transport,lines,status:'issued',requiresSignedGate:true,stockPosting:false};
  await c.query('INSERT INTO inventory_warehouse_transfers(id,number,source_warehouse,destination_warehouse,source_sha256,destination_source_sha256,snapshot,request_key,request_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,number,input.source.warehouse,input.destination.warehouse,input.source.sourceSha256,input.destination.sourceSha256,snapshot,input.requestKey,fingerprint(input),actor]);
  for(const line of lines){
   await c.query('INSERT INTO inventory_warehouse_transfer_lines(transfer_id,line_key,item_id,unit,destination_unit,description,quantity,source_sha256,source_ledger_key,destination_source_sha256,destination_ledger_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,line.lineKey,line.itemId,line.unit,line.destinationUnit,line.description,line.quantity,input.source.sourceSha256,line.sourceLedgerKey,input.destination.sourceSha256,line.destinationLedgerKey]);
  }
  await deferDispatch(c,actor,'transfer-out',id,input.source.warehouse,input.source.sourceSha256,input.source.authorityVersion,lines.map(l=>({ledgerKey:l.sourceLedgerKey,quantity:l.quantity,kind:'transfer-out',transferId:id,transferLineKey:l.lineKey})));
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'inventory.transfer.issue:'+id]);return {id,number,stockPosted:false,awaitingSignedGate:true};
 });}
 async receive(actor:string,raw:z.infer<typeof warehouseTransferReceiptSchema>){const input=warehouseTransferReceiptSchema.parse(raw);return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.transfer.receipt.request.'||$1,0))",[input.requestKey]);
  const replay=(await c.query('SELECT r.*,t.destination_warehouse FROM inventory_warehouse_transfer_receipts r JOIN inventory_warehouse_transfers t ON t.id=r.transfer_id WHERE r.request_key=$1',[input.requestKey])).rows[0];if(replay){await postingScope(actor,replay.destination_warehouse,c);if(replay.verified_by!==actor||replay.request_fingerprint!==fingerprint(input))throw new HttpError(409,'This request belongs to another transfer receipt.');return {id:replay.id,number:replay.number,stockPosted:true};}
  const transfer=await this.row(actor,input.transferId,c,true);if(!await dispatchPosted(c,'transfer-out',transfer.id))throw new HttpError(409,'Upload the signed source gate copy before receiving this transfer.');await postingScope(actor,transfer.destination_warehouse,c);
  if(input.destinationSourceSha256!==transfer.destination_source_sha256)throw new HttpError(409,'Keep the reviewed destination baseline of the original transfer.');await lockWarehouseAuthority(c,transfer.destination_warehouse,input.destinationSourceSha256,input.authorityVersion);
  const evidence=(await c.query('SELECT id,warehouse,sha256 FROM inventory_material_evidence WHERE id=$1',[input.evidenceId])).rows[0];if(!evidence||evidence.warehouse!==transfer.destination_warehouse)throw new HttpError(422,'Attach counted and verified destination warehouse evidence.');
  if((await c.query('SELECT 1 FROM inventory_warehouse_transfer_receipts WHERE evidence_id=$1',[input.evidenceId])).rowCount)throw new HttpError(409,'This counted transfer evidence has already been credited.');
  if(new Set(input.lines.map(l=>l.lineKey)).size!==input.lines.length)throw new HttpError(422,'Record each counted transfer row once.');
  const sent=(await c.query(`SELECT l.*,coalesce((SELECT sum(r.quantity) FROM inventory_warehouse_transfer_receipt_lines r WHERE r.transfer_id=l.transfer_id AND r.line_key=l.line_key),0)::text received FROM inventory_warehouse_transfer_lines l WHERE transfer_id=$1 ORDER BY destination_ledger_key`,[transfer.id])).rows;
  const prepared=[];for(const line of input.lines){const original=sent.find(l=>l.line_key===line.lineKey);if(!original)throw new HttpError(422,'This row is not on the issued transfer.');if(new Decimal(line.quantity).gt(new Decimal(original.quantity).minus(original.received)))throw new HttpError(422,'Counted receipt exceeds material still in transit.');await finalItem(c,original.item_id);prepared.push({request:line,original});}
  const positions=new Map<string,Position>();for(const p of [...prepared].sort((a,b)=>a.original.destination_ledger_key.localeCompare(b.original.destination_ledger_key))){const position=reviewed(await warehousePosition(c,input.destinationSourceSha256,p.original.destination_ledger_key,true),transfer.destination_warehouse,p.original.item_id);if(position.baseline.unit!==p.original.destination_unit||!sameUnit(p.original.unit,position.baseline.unit))throw new HttpError(422,'The reviewed destination unit changed. No automatic conversion is allowed.');if(sameUnit(position.baseline.unit,'No.')&&!new Decimal(p.request.quantity).isInteger())throw new HttpError(422,'Whole-item stock must be counted in whole quantities.');if(position.ledgerRevision!==p.request.ledgerRevision)throw new HttpError(409,'Destination warehouse balance changed. Refresh before receiving.');positions.set(p.original.destination_ledger_key,position);}
  const id=randomUUID(),number=await warehouseNumber(c,'IGP',id),snapshot={warehouse:transfer.destination_warehouse,transferId:transfer.id,transferNumber:transfer.number,sourceWarehouse:transfer.source_warehouse,evidence:{id:evidence.id,sha256:evidence.sha256},reason:input.reason,lines:prepared.map(p=>({lineKey:p.request.lineKey,itemId:p.original.item_id,unit:p.original.destination_unit,description:p.original.description,quantity:p.request.quantity})),stockPosting:true};
  await c.query('INSERT INTO inventory_warehouse_transfer_receipts(id,number,transfer_id,evidence_id,snapshot,reason,request_key,request_fingerprint,verified_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,number,transfer.id,evidence.id,snapshot,input.reason,input.requestKey,fingerprint(input),actor]);
  for(const p of prepared){await c.query('INSERT INTO inventory_warehouse_transfer_receipt_lines(receipt_id,transfer_id,line_key,quantity) VALUES($1,$2,$3,$4)',[id,transfer.id,p.request.lineKey,p.request.quantity]);const position=positions.get(p.original.destination_ledger_key)!,before=position.currentClosing!,after=new Decimal(before).plus(p.request.quantity).toString();await c.query("INSERT INTO inventory_warehouse_operational_movements(id,source_sha256,ledger_key,ledger_revision,kind,transfer_id,transfer_line_key,transfer_receipt_id,in_delta,out_delta,closing_before,closing_after,created_by) VALUES($1,$2,$3,$4,'transfer-in',$5,$6,$7,$8,0,$9,$10,$11)",[randomUUID(),input.destinationSourceSha256,p.original.destination_ledger_key,position.ledgerRevision+1,transfer.id,p.request.lineKey,id,p.request.quantity,before,after,actor]);}
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'inventory.transfer.receive:'+transfer.id+':'+id]);return {id,number,stockPosted:true};
 });}
}
