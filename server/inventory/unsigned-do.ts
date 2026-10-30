import {temporaryNegativeDoBalanceAllowed} from './do-negative-balance.js';
import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {Decimal} from 'decimal.js';
import {z} from 'zod';
import {transaction} from '../db/transaction.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {HttpError} from '../http/errors.js';
import {requireWarehouseAccess} from './warehouse-access.js';
import {warehousePosition} from './warehouse-ledger.js';
import {warehouseLedgerKey} from './warehouse-source.js';
import {fixedPreparationRows} from '../../shared/material-preparation.js';
import {materialDocumentPolicy} from '../../shared/material-documents.js';
import {issuedDispatchPrintModel} from './material-document-model.js';
import {MaterialDraftRepository} from './material-drafts.js';
const line=z.object({key:z.uuid(),itemId:z.string().min(1).max(300),unit:z.string().min(1).max(100),out:z.string().regex(/^\d{1,14}(?:\.\d{1,6})?$/).refine(v=>new Decimal(v).gt(0))}).strict();
export const unsignedDoInput=z.object({revision:z.number().int().positive(),requestKey:z.uuid(),action:z.enum(['edit','delete']),partialDelivery:z.boolean().optional(),reason:z.string().trim().min(3).max(2000),transport:z.object({issuedTo:z.string().trim().min(1).max(200),vehicle:z.string().max(200),driver:z.string().max(200),driverIdentity:z.string().max(200)}).strict().optional(),lines:z.array(line).min(1).max(2000).optional()}).strict();
export class UnsignedDoRepository{
 constructor(private pool:Pool){}
 async detail(actor:string,id:string){
  const record=(await this.pool.query('SELECT * FROM inventory_material_dispatches WHERE id=$1',[id])).rows[0];if(!record)throw new HttpError(404,'DO not found.');
  await requireWarehouseAccess(actor,record.warehouse,this.pool);
  const locked=!(await this.pool.query("SELECT 1 FROM inventory_signed_dispatch_pending WHERE document_kind='dispatch' AND document_id=$1",[id])).rowCount||(await this.pool.query("SELECT 1 FROM inventory_gate_pass_copies WHERE document_kind='dispatch' AND document_id=$1 AND copy_kind='signed-gate' UNION ALL SELECT 1 FROM inventory_signed_dispatch_postings WHERE document_kind='dispatch' AND document_id=$1",[id])).rowCount!>0;
  const history=(await this.pool.query('SELECT revision,action,reason,created_at FROM inventory_material_dispatch_revisions WHERE dispatch_id=$1 ORDER BY revision',[id])).rows;
  const catalogue=(await new MaterialDraftRepository(this.pool).catalogue(actor)).catalogue;
  return {id,number:record.number,warehouse:record.warehouse,revision:record.snapshot.doRevision??1,cancelled:!!record.snapshot.cancelled,editable:!locked&&!record.snapshot.cancelled,snapshot:record.snapshot,model:issuedDispatchPrintModel(record),catalogue,history};
 }
 async change(actor:string,id:string,raw:unknown){
  const input=unsignedDoInput.parse(raw),fingerprint=createHash('sha256').update(JSON.stringify({id,...input})).digest('hex');
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   // The gate-copy transaction takes this same lock before reading its version.
   const pending=(await c.query("SELECT * FROM inventory_signed_dispatch_pending WHERE document_kind='dispatch' AND document_id=$1 FOR UPDATE",[id])).rows[0];
   const record=(await c.query('SELECT * FROM inventory_material_dispatches WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!record)throw new HttpError(404,'DO not found.');
   await requireWarehouseAccess(actor,record.warehouse,c);
   const replay=(await c.query('SELECT * FROM inventory_material_dispatch_revisions WHERE request_key=$1',[input.requestKey])).rows[0];if(replay){if(replay.created_by!==actor||replay.fingerprint!==fingerprint)throw new HttpError(409,'This request belongs to another DO change.');return {id,number:record.number,revision:replay.revision,cancelled:replay.action==='delete',stockPosted:false};}
   if(!pending||(await c.query("SELECT 1 FROM inventory_gate_pass_copies WHERE document_kind='dispatch' AND document_id=$1 AND copy_kind='signed-gate' UNION ALL SELECT 1 FROM inventory_signed_dispatch_postings WHERE document_kind='dispatch' AND document_id=$1 UNION ALL SELECT 1 FROM inventory_warehouse_operational_movements WHERE dispatch_id=$1 UNION ALL SELECT 1 FROM inventory_material_receipt_lines WHERE dispatch_id=$1",[id])).rowCount)throw new HttpError(409,'This DO is locked because its signed gate copy or stock movement is already recorded.');
   if(record.snapshot.cancelled)throw new HttpError(409,'This DO is already deleted. Its history is retained.');
   if((record.snapshot.doRevision??1)!==input.revision)throw new HttpError(409,'This DO changed. Reopen it before editing or deleting.');
   const beforeLines=(await c.query('SELECT * FROM inventory_material_dispatch_lines WHERE dispatch_id=$1 ORDER BY line_key',[id])).rows;
   let snapshot={...record.snapshot,doRevision:input.revision+1,cancelled:input.action==='delete'};
   const positions=new Map<string,any>();
   if(input.action==='edit'){
    if(!input.lines?.length||!input.transport)throw new HttpError(422,'Enter the DO items and delivery details.');
    if(new Set(input.lines.map(l=>l.key)).size!==input.lines.length)throw new HttpError(422,'Each DO row must be selected once.');
    const catalogue=(await c.query("SELECT DISTINCT payload->>'itemId' item_id,payload->>'unit' unit,payload->>'description' description FROM inventory_warehouse_source_balances WHERE source_sha256=$1 AND payload->>'warehouse'=$2",[record.source_sha256,record.warehouse])).rows;
    const preparations=(await c.query('SELECT snapshot FROM inventory_material_draft_versions WHERE (draft_id,version) IN (SELECT draft_id,max(version) FROM inventory_material_draft_versions WHERE draft_id=ANY($1::uuid[]) GROUP BY draft_id)',[record.snapshot.combinedPlan?[record.snapshot.combinedPlan.fixedDraftId,record.snapshot.combinedPlan.variableDraftId].filter(Boolean):[record.draft_id]])).rows.flatMap(r=>r.snapshot.lines);
    const usedKeys=new Set(input.lines.filter(l=>record.snapshot.lines.some((r:any)=>r.key===l.key&&r.itemId===l.itemId&&r.unit===l.unit)).map(l=>l.key));
    const lines=input.lines.map(l=>{if(!record.snapshot.lines.some((r:any)=>r.key===l.key&&r.itemId===l.itemId&&r.unit===l.unit)){const basis=preparations.find((r:any)=>r.itemId===l.itemId&&r.unit===l.unit&&!usedKeys.has(r.key));if(basis){l={...l,key:basis.key};usedKeys.add(l.key);}else throw new HttpError(422,'Add this item to the saved material preparation first, then edit this DO. This keeps its issue, return and sign-off records linked.');}const original=record.snapshot.lines.find((r:any)=>r.key===l.key&&r.itemId===l.itemId&&r.unit===l.unit)??preparations.find((r:any)=>r.key===l.key&&r.itemId===l.itemId&&r.unit===l.unit),item=catalogue.find(r=>r.item_id===l.itemId&&r.unit===l.unit);if(!item)throw new HttpError(422,'Select an item and unit from this warehouse stock catalogue.');const row={...original,key:l.key,itemId:l.itemId,unit:l.unit,description:item.description,out:new Decimal(l.out).toString(),sites:original?.sites??record.snapshot.sites.map((s:any)=>s.siteId)};const policy=materialDocumentPolicy(row);if(policy.approvedQuantityLocked||policy.group==='non-stock')throw new HttpError(422,'Only physical stock items belong on a DO.');return row;});
    for(const key of [...new Set(lines.map(l=>warehouseLedgerKey(l.itemId,record.warehouse,l.unit)))].sort()){
     const p=await warehousePosition(c,record.source_sha256,key,true);if(!p)throw new HttpError(422,'The selected stock item is not recorded in this warehouse.');
     const total=lines.filter(l=>warehouseLedgerKey(l.itemId,record.warehouse,l.unit)===key).reduce((n,l)=>n.plus(l.out),new Decimal(0));if(!temporaryNegativeDoBalanceAllowed()&&p.currentClosing!==null&&new Decimal(p.currentClosing).lt(total))throw new HttpError(409,'Recorded warehouse stock is insufficient for this DO.');positions.set(key,p);
    }
    const partialDelivery=input.partialDelivery??!!snapshot.partialDelivery;
    if(!snapshot.parent&&!partialDelivery){const stockCatalogue=catalogue.map(r=>({itemId:r.item_id,description:r.description,units:[r.unit]}));const fixed=fixedPreparationRows(snapshot.sites[0],stockCatalogue,()=>'',{}).filter(r=>r.out!==''&&!materialDocumentPolicy(r).approvedQuantityLocked);for(const basis of fixed){const entered=lines.filter((r:any)=>basis.basisLine!==undefined?r.basisLine===basis.basisLine:r.itemId===basis.itemId).reduce((n:Decimal,r:any)=>n.plus(r.out),new Decimal(0));if(entered.lt(basis.out))throw new HttpError(422,'Fixed items are below the approved BOQ. Select Partial delivery for a reduced fixed-item DO.');}}
    snapshot={...snapshot,lines,transport:input.transport,partialDelivery};
   }
   await c.query('INSERT INTO inventory_material_dispatch_revisions(dispatch_id,revision,action,before_record,before_lines,before_pending,after_snapshot,reason,request_key,fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,input.revision+1,input.action,record,JSON.stringify(beforeLines),pending,snapshot,input.reason,input.requestKey,fingerprint,actor]);
   await c.query('UPDATE inventory_material_dispatches SET snapshot=$2 WHERE id=$1',[id,snapshot]);
   if(input.action==='edit'){
    await c.query('DELETE FROM inventory_material_dispatch_lines WHERE dispatch_id=$1',[id]);
    const movements=[];
    for(const l of snapshot.lines){const ledgerKey=warehouseLedgerKey(l.itemId,record.warehouse,l.unit);await c.query('INSERT INTO inventory_material_dispatch_lines(dispatch_id,line_key,source_sha256,ledger_key,item_id,unit,description,quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,l.key,record.source_sha256,ledgerKey,l.itemId,l.unit,l.description,l.out]);movements.push({ledgerKey,quantity:l.out,kind:'dispatch-out',draftId:record.draft_id,dispatchId:id,lineKey:l.key});}
    await c.query("UPDATE inventory_signed_dispatch_pending SET movements=$2 WHERE document_kind='dispatch' AND document_id=$1",[id,JSON.stringify(movements)]);
   }
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'inventory.unsigned_do.'+input.action+':'+id+':revision:'+snapshot.doRevision]);
   return {id,number:record.number,revision:snapshot.doRevision,cancelled:input.action==='delete',stockPosted:false};
  });
 }
}
