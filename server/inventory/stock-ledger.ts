import type {Pool} from 'pg';
import {z} from 'zod';
import {HttpError} from '../http/errors.js';
import {MaterialDraftRepository} from './material-drafts.js';

const filterSchema=z.object({warehouse:z.string().max(200).optional(),itemId:z.string().max(200).optional(),unit:z.string().max(40).optional(),direction:z.enum(['all','in','out']).default('all'),offset:z.coerce.number().int().min(0).max(100000).default(0)}).strict();
/** A scoped, paginated read of original evidence and actual posted movements. */
export async function stockLedger(pool:Pool,actor:string,input:unknown){
 const parsed=filterSchema.safeParse(input);if(!parsed.success)throw new HttpError(422,'Check the stock ledger filters.');const f=parsed.data;
 const access=await new MaterialDraftRepository(pool).warehouses(actor);
 if(f.warehouse&&!access.warehouses.includes(f.warehouse))throw new HttpError(403,'This warehouse ledger is outside your scope.');
 const warehouses=f.warehouse?[f.warehouse]:access.warehouses;
 const result=await pool.query(`WITH reference AS (
 SELECT source_sha256 FROM inventory_warehouse_sources ORDER BY (coalesce(metadata->>'canonicalIds','') ~ '^[1-9][0-9]*$') DESC,created_at DESC,source_sha256 LIMIT 1
 ), scope AS (
 SELECT w.warehouse,coalesce(a.source_sha256,r.source_sha256) source_sha256 FROM unnest($1::text[]) w(warehouse) CROSS JOIN reference r LEFT JOIN inventory_warehouse_authority_current a ON a.warehouse=w.warehouse
 ), balances AS (
 SELECT b.* FROM inventory_warehouse_source_balances b JOIN scope s ON s.source_sha256=b.source_sha256 AND s.warehouse=b.payload->>'warehouse'
 WHERE ($2::text IS NULL OR b.payload->>'itemId'=$2) AND ($3::text IS NULL OR b.payload->>'unit'=$3)
 ), events AS (
 SELECT 'history:'||e.event_id id,coalesce(e.payload->>'date','') date,e.payload->>'itemId' "itemId",e.payload->>'description' description,e.payload->>'warehouse' warehouse,e.payload->>'unit' unit,
 coalesce(e.payload->>'in','0') incoming,coalesce(e.payload->>'out','0') outgoing,coalesce(e.payload->>'doNumber',e.payload->>'document',e.payload->>'reference','') reference,coalesce(e.payload->>'ipo','') ipo,
 coalesce(e.payload->>'movement','Historical stock evidence') kind,coalesce(e.payload->>'notes',e.payload->>'remarks','') note
 FROM inventory_warehouse_source_events e JOIN scope s ON s.source_sha256=e.source_sha256 AND s.warehouse=e.payload->>'warehouse'
 WHERE ($2::text IS NULL OR e.payload->>'itemId'=$2) AND ($3::text IS NULL OR e.payload->>'unit'=$3)
 UNION ALL
 SELECT 'correction:'||c.case_id,c.created_at::text,b.payload->>'itemId',b.payload->>'description',b.payload->>'warehouse',b.payload->>'unit',c.in_delta::text,'0',c.case_id,'','Approved return correction',''
 FROM inventory_warehouse_return_corrections c JOIN balances b USING(source_sha256,ledger_key)
 UNION ALL
 SELECT 'posted:'||m.id::text,m.created_at::text,b.payload->>'itemId',b.payload->>'description',b.payload->>'warehouse',b.payload->>'unit',m.in_delta::text,m.out_delta::text,
 coalesce(rd.number,rr.number,t.number,p.number,r.number,d.number,''),'',m.kind,''
 FROM inventory_warehouse_operational_movements m JOIN balances b USING(source_sha256,ledger_key)
 LEFT JOIN inventory_material_dispatches d ON d.id=m.dispatch_id
 LEFT JOIN inventory_material_receipts r ON r.id=m.receipt_id
 LEFT JOIN inventory_material_purchase_receipts p ON p.id=m.purchase_receipt_id
 LEFT JOIN inventory_warehouse_transfers t ON t.id=m.transfer_id
 LEFT JOIN inventory_material_replacement_dispatches rd ON rd.id=m.replacement_dispatch_id
 LEFT JOIN inventory_material_replacement_usable_releases rel ON rel.id=m.replacement_release_id
 LEFT JOIN inventory_material_replacement_returns rr ON rr.id=rel.return_id
 ), filtered AS (SELECT * FROM events WHERE $4='all' OR ($4='in' AND incoming::numeric<>0) OR ($4='out' AND outgoing::numeric<>0))
 SELECT (SELECT count(*)::int FROM filtered) total,coalesce((SELECT jsonb_agg(row_to_json(page)) FROM (SELECT * FROM filtered ORDER BY date DESC,id DESC LIMIT 100 OFFSET $5) page),'[]'::jsonb) events`,[warehouses,f.itemId||null,f.unit||null,f.direction,f.offset]);
 return {events:result.rows[0].events,total:result.rows[0].total,offset:f.offset,limit:100};
}
