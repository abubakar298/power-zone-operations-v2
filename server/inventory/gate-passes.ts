import {postSignedDispatch,dispatchPosted} from './signed-dispatch.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {HttpError} from '../http/errors.js';
import {transaction} from '../db/transaction.js';
import {requireWarehouseAccess} from './warehouse-access.js';
export const gatePassKind=z.enum(['dispatch','return','purchase','transfer-out','transfer-in','replacement-out','replacement-in']);
export const gatePassCopySchema=z.object({kind:gatePassKind,documentId:z.uuid(),copyKind:z.enum(['signed-gate','signed-store']),evidenceId:z.uuid(),note:z.string().trim().min(3).max(2000),requestKey:z.uuid()}).strict();
type Kind=z.infer<typeof gatePassKind>;
const docs=`SELECT 'dispatch' kind,id,number,warehouse,created_at FROM inventory_material_dispatches UNION ALL SELECT 'return',id,number,snapshot->>'warehouse',created_at FROM inventory_material_receipts UNION ALL SELECT 'purchase',id,number,warehouse,created_at FROM inventory_material_purchase_receipts`;
export class GatePassRepository{
 constructor(private pool:Pool){}
 private async documents(c:Pool|PoolClient=this.pool){const available=(await c.query("SELECT to_regclass('public.inventory_warehouse_transfers') IS NOT NULL AND to_regclass('public.inventory_warehouse_transfer_receipts') IS NOT NULL transfers,to_regclass('public.inventory_material_replacement_dispatches') IS NOT NULL AND to_regclass('public.inventory_material_replacement_returns') IS NOT NULL replacements")).rows[0];return docs+(available.transfers?" UNION ALL SELECT 'transfer-out',id,number,source_warehouse,created_at FROM inventory_warehouse_transfers UNION ALL SELECT 'transfer-in',r.id,r.number,t.destination_warehouse,r.created_at FROM inventory_warehouse_transfer_receipts r JOIN inventory_warehouse_transfers t ON t.id=r.transfer_id":'')+(available.replacements?" UNION ALL SELECT 'replacement-out',id,number,warehouse,created_at FROM inventory_material_replacement_dispatches UNION ALL SELECT 'replacement-in',id,number,warehouse,created_at FROM inventory_material_replacement_returns":'');}

 async access(actor:string){const user=(await this.pool.query('SELECT active,role FROM users WHERE id=$1',[actor])).rows[0];if(!user?.active)throw new HttpError(401,'Your access has ended.');if(['Admin','Management'].includes(user.role))return {kind:'management',warehouses:[]};if(user.role!=='Inventory')throw new HttpError(403,'Warehouse document access is required.');const rows=(await this.pool.query('SELECT warehouse,capability FROM inventory_material_access WHERE user_id=$1 ORDER BY warehouse,capability',[actor])).rows;return {kind:rows.some(r=>r.capability==='dispatcher')?'dispatcher':rows.some(r=>r.capability==='storekeeper')?'storekeeper':'unassigned',warehouses:[...new Set(rows.map(r=>r.warehouse))]};}
 async list(actor:string){
  const access=await this.access(actor),owner=access.kind==='management',docs=await this.documents();
  if(access.kind==='unassigned')throw new HttpError(403,'Warehouse document access is required.');
  const warehouses=owner?(await this.pool.query(`SELECT DISTINCT warehouse FROM (${docs}) d UNION SELECT warehouse FROM inventory_warehouse_authority_current ORDER BY warehouse`)).rows.map(r=>r.warehouse):(await this.pool.query("SELECT DISTINCT warehouse FROM inventory_material_access WHERE user_id=$1 AND capability IN('dispatcher','storekeeper') ORDER BY warehouse",[actor])).rows.map(r=>r.warehouse);
  if(!owner&&!warehouses.length)throw new HttpError(403,'Warehouse document access is required.');
  const records=(await this.pool.query(`SELECT d.*, (SELECT count(*)::int FROM inventory_gate_pass_copies c WHERE c.document_kind=d.kind AND c.document_id=d.id) signed_copies FROM (${docs}) d WHERE warehouse=ANY($1) ORDER BY created_at DESC,id DESC`,[warehouses])).rows;
  return {kind:access.kind,warehouses,records};
 }
 async record(actor:string,kind:Kind,id:string,c:Pool|PoolClient=this.pool){
  let row:any;
  if(kind==='replacement-out'||kind==='replacement-in'){
   if(!(await c.query("SELECT to_regclass('public.inventory_material_replacement_dispatches') IS NOT NULL AND to_regclass('public.inventory_material_replacement_returns') IS NOT NULL ready")).rows[0].ready)throw new HttpError(404,'Warehouse document not found.');
   const table=kind==='replacement-out'?'inventory_material_replacement_dispatches':'inventory_material_replacement_returns';
   row=(await c.query(`SELECT d.id,d.number,d.warehouse,d.case_id,d.snapshot,d.created_at,c.snapshot->'sites' AS case_sites FROM ${table} d JOIN inventory_material_replacement_cases c ON c.id=d.case_id WHERE d.id=$1`,[id])).rows[0];
   if(row&&!row.snapshot.sites)row.snapshot={...row.snapshot,sites:row.case_sites??[]};
  }else if(kind==='transfer-out'||kind==='transfer-in'){
   if(!(await c.query("SELECT to_regclass('public.inventory_warehouse_transfers') IS NOT NULL AND to_regclass('public.inventory_warehouse_transfer_receipts') IS NOT NULL ready")).rows[0].ready)throw new HttpError(404,'Warehouse document not found.');
   row=kind==='transfer-out'?(await c.query('SELECT id,number,snapshot,created_at,source_warehouse warehouse FROM inventory_warehouse_transfers WHERE id=$1',[id])).rows[0]:(await c.query('SELECT r.id,r.number,r.snapshot,r.created_at,t.destination_warehouse warehouse FROM inventory_warehouse_transfer_receipts r JOIN inventory_warehouse_transfers t ON t.id=r.transfer_id WHERE r.id=$1',[id])).rows[0];
  }else{
   const table=kind==='dispatch'?'inventory_material_dispatches':kind==='return'?'inventory_material_receipts':'inventory_material_purchase_receipts';
   row=(await c.query(`SELECT id,number,snapshot,created_at,${kind==='return'?"snapshot->>'warehouse'":'warehouse'} warehouse FROM ${table} WHERE id=$1`,[id])).rows[0];
  }
  if(!row)throw new HttpError(404,'Warehouse document not found.');await requireWarehouseAccess(actor,row.warehouse,c,true);if(['dispatch','transfer-out','replacement-out','replacement-in'].includes(kind))row.snapshot={...row.snapshot,stockPosting:await dispatchPosted(c,kind as 'dispatch'|'transfer-out'|'replacement-out'|'replacement-in',id)};return row;
 }
 async detail(actor:string,kind:Kind,id:string){const record=await this.record(actor,kind,id);return {id:record.id,number:record.number,warehouse:record.warehouse,created_at:record.created_at,kind,copies:(await this.pool.query('SELECT id,copy_kind,evidence_id,note,created_at FROM inventory_gate_pass_copies WHERE document_kind=$1 AND document_id=$2 ORDER BY created_at,id',[kind,id])).rows};}
 async attach(actor:string,raw:z.infer<typeof gatePassCopySchema>){const input=gatePassCopySchema.parse(raw),fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
  const record=await this.record(actor,input.kind,input.documentId,c);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.gate.copy.'||$1,0))",[input.requestKey]);
  const replay=(await c.query('SELECT id,fingerprint,created_by FROM inventory_gate_pass_copies WHERE request_key=$1',[input.requestKey])).rows[0];if(replay){if(replay.fingerprint!==fingerprint||replay.created_by!==actor)throw new HttpError(409,'This request belongs to another document copy.');return {id:replay.id,stockPosted:false};}
  const evidence=(await c.query('SELECT warehouse FROM inventory_material_evidence WHERE id=$1',[input.evidenceId])).rows[0];if(!evidence||evidence.warehouse!==record.warehouse)throw new HttpError(422,'Upload the signed copy for this warehouse.');
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.gate.copy.document.'||$1,0))",[input.kind+':'+input.documentId+':'+input.copyKind+':'+input.evidenceId]);
  const existing=(await c.query('SELECT id FROM inventory_gate_pass_copies WHERE document_kind=$1 AND document_id=$2 AND copy_kind=$3 AND evidence_id=$4',[input.kind,input.documentId,input.copyKind,input.evidenceId])).rows[0];if(existing)return {id:existing.id,stockPosted:false};
  const stockPosted=await postSignedDispatch(c,actor,input.kind,input.documentId,input.copyKind,input.evidenceId);
  const id=randomUUID();await c.query('INSERT INTO inventory_gate_pass_copies(id,document_kind,document_id,warehouse,copy_kind,evidence_id,note,request_key,fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,input.kind,input.documentId,record.warehouse,input.copyKind,input.evidenceId,input.note,input.requestKey,fingerprint,actor]);await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`inventory.gate_copy.${input.copyKind}:${input.kind}:${input.documentId}`]);return {id,stockPosted};
 });}
}
