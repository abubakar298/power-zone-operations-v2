import {nextWarehouseClosing} from './warehouse-ledger.js';
import type {Pool,PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {HttpError} from '../http/errors.js';
import {lockWarehouseAuthority,requireWarehouseAccess} from './warehouse-access.js';
import {warehousePosition} from './warehouse-ledger.js';
type Kind='dispatch'|'transfer-out'|'replacement-out'|'replacement-in';
type Movement={ledgerKey:string;quantity:string;kind:'dispatch-out'|'transfer-out'|'replacement-out';draftId?:string;dispatchId?:string;lineKey?:string;transferId?:string;transferLineKey?:string;replacementDispatchId?:string};
export async function deferDispatch(c:PoolClient,actor:string,kind:Kind,id:string,warehouse:string,source:string,version:number,movements:Movement[]){
 await c.query('INSERT INTO inventory_signed_dispatch_pending(document_kind,document_id,warehouse,source_sha256,authority_version,movements,created_by)VALUES($1,$2,$3,$4,$5,$6,$7)',[kind,id,warehouse,source,version,JSON.stringify(movements),actor]);
}
/** Absence means a legacy document already governed by its original posting. */
export async function dispatchPosted(c:Pool|PoolClient,kind:Kind,id:string){if(!(await c.query("SELECT to_regclass('public.inventory_signed_dispatch_pending') IS NOT NULL ready")).rows[0].ready)return true;return !(await c.query(`SELECT 1 FROM inventory_signed_dispatch_pending p WHERE p.document_kind=$1 AND p.document_id=$2 AND NOT EXISTS(SELECT 1 FROM inventory_signed_dispatch_postings s WHERE s.document_kind=p.document_kind AND s.document_id=p.document_id)`,[kind,id])).rowCount;}
/** Called inside the gate-copy transaction. Upload and all stock deltas commit
 * together; competing uploads lock the same authorized document. */
export async function postSignedDispatch(c:PoolClient,actor:string,kind:string,id:string,copyKind:string,evidenceId:string){
 if(kind==='replacement-in'?copyKind!=='signed-store':!['dispatch','transfer-out','replacement-out'].includes(kind)||copyKind!=='signed-gate')return false;
 const row=(await c.query('SELECT * FROM inventory_signed_dispatch_pending WHERE document_kind=$1 AND document_id=$2 FOR UPDATE',[kind,id])).rows[0];
 if(!row||await dispatchPosted(c,kind as Kind,id))return false;
 if(kind==='dispatch'&&!(await c.query('SELECT 1 FROM inventory_material_dispatches_active WHERE id=$1',[id])).rowCount)throw new HttpError(409,'This DO was deleted. Select a current DO.');
 await requireWarehouseAccess(actor,row.warehouse,c,true);
 const evidence=(await c.query('SELECT warehouse FROM inventory_material_evidence WHERE id=$1',[evidenceId])).rows[0];if(!evidence||evidence.warehouse!==row.warehouse)throw new HttpError(422,'Upload the signed gate copy for the dispatch warehouse.');
 if(kind!=='replacement-in')await lockWarehouseAuthority(c,row.warehouse,row.source_sha256,row.authority_version);
 const lines=row.movements as Movement[],positions=new Map<string,NonNullable<Awaited<ReturnType<typeof warehousePosition>>>>();
 for(const key of [...new Set(lines.map(l=>l.ledgerKey))].sort()){const p=await warehousePosition(c,row.source_sha256,key,true),total=lines.filter(l=>l.ledgerKey===key).reduce((n,l)=>n.plus(l.quantity),new Decimal(0));if(!p||p.currentClosing!==null&&new Decimal(p.currentClosing).lt(total))throw new HttpError(409,'The source item is missing or its recorded stock is insufficient. The signed copy and warehouse OUT were not posted.');positions.set(key,p);}
 for(const l of lines){const p=positions.get(l.ledgerKey)!,before=p.currentClosing,after=nextWarehouseClosing(before,l.quantity,-1);const values:Record<string,unknown>={id:randomUUID(),source_sha256:row.source_sha256,ledger_key:l.ledgerKey,ledger_revision:p.ledgerRevision+1,kind:l.kind,in_delta:'0',out_delta:l.quantity,closing_before:before,closing_after:after,created_by:actor};if(l.kind==='transfer-out')Object.assign(values,{transfer_id:l.transferId,transfer_line_key:l.transferLineKey});else{Object.assign(values,{draft_id:l.draftId,dispatch_id:l.dispatchId,line_key:l.lineKey});if(l.kind==='replacement-out')values.replacement_dispatch_id=l.replacementDispatchId;}const cols=Object.keys(values);await c.query('INSERT INTO inventory_warehouse_operational_movements('+cols.join(',')+')VALUES('+cols.map((_,i)=>'$'+(i+1)).join(',')+')',Object.values(values));p.currentClosing=after;p.ledgerRevision++;}

 await c.query('INSERT INTO inventory_signed_dispatch_postings(document_kind,document_id,evidence_id,posted_by)VALUES($1,$2,$3,$4)',[kind,id,evidenceId,actor]);
 await c.query('INSERT INTO audit_log(user_id,action)VALUES($1,$2)',[actor,'inventory.signed_dispatch.posted:'+kind+':'+id]);return true;
}
