import {Router,type RequestHandler} from 'express';
import type {Pool} from 'pg';
import {z} from 'zod';
import {equalSecrets} from '../auth/crypto.js';
import {HttpError} from '../http/errors.js';
import {WarehouseTransferRepository,warehouseTransferIssueSchema,warehouseTransferReceiptSchema} from './warehouse-transfers.js';
import {GatePassRepository} from './gate-passes.js';
import {requireWarehouseAccess} from './warehouse-access.js';
import {warehouseTransferPrintModel,warehouseTransferReceiptPrintModel,warehouseTransferCopies} from './warehouse-transfer-documents.js';
import {materialDocumentPdf} from './material-document-pdf.js';
/** Mount at /api/warehouse-transfers. Existing session and repository scopes remain authoritative. */
export function warehouseTransferHttp(pool:Pool,requireSession:RequestHandler){
 const r=Router(),repo=new WarehouseTransferRepository(pool),gates=new GatePassRepository(pool);
 r.use(requireSession);
 r.use((_req,res,next)=>{res.set({"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});next();});
 r.use((req,_res,next)=>{if(req.method!=='GET'&&!equalSecrets(req.get('X-CSRF-Token')??'',req.authSession!.csrfToken))throw new HttpError(403,'Refresh and try again.');next();});
 const ready=async()=>!!(await pool.query("SELECT to_regclass('public.inventory_warehouse_transfers') IS NOT NULL AND to_regclass('public.inventory_warehouse_transfer_receipts') IS NOT NULL ready")).rows[0].ready;
 const id=(value:unknown)=>{const v=z.uuid().safeParse(value);if(!v.success)throw new HttpError(400,'Invalid warehouse transfer.');return v.data;};
 const name=(value:unknown)=>{const v=z.string().trim().min(1).max(200).safeParse(value);if(!v.success)throw new HttpError(400,'Choose a warehouse.');return v.data;};
 async function access(actor:string){
  const a=await gates.access(actor);if(a.kind==='unassigned')throw new HttpError(403,'Warehouse document access is required.');
  const all=(await pool.query(`SELECT DISTINCT warehouse FROM (
   SELECT payload->>'warehouse' AS warehouse FROM inventory_warehouse_source_balances
   WHERE source_sha256=(SELECT source_sha256 FROM inventory_warehouse_sources ORDER BY (coalesce(metadata->>'canonicalIds','') ~ '^[1-9][0-9]*$') DESC,created_at DESC,source_sha256 LIMIT 1)
   UNION SELECT warehouse FROM inventory_warehouse_authority_current
  ) known WHERE warehouse IS NOT NULL AND btrim(warehouse)<>'' ORDER BY warehouse`)).rows.map(v=>v.warehouse as string);
  const sourceWarehouses=a.kind==='management'?all:(await pool.query("SELECT DISTINCT warehouse FROM inventory_material_access WHERE user_id=$1 AND capability='dispatcher' ORDER BY warehouse",[actor])).rows.map(v=>v.warehouse as string);
  return {enabled:await ready(),kind:a.kind,warehouses:all,readWarehouses:a.kind==='management'?all:a.warehouses,sourceWarehouses,receiptWarehouses:sourceWarehouses};
 }
 r.get('/access',async(req,res)=>res.json(await access(req.authSession!.user.id)));
 r.use(async(req,_res,next)=>{if(!await ready())throw new HttpError(409,'Warehouse transfers are not available until their verified migration is installed.');next();});
 r.get('/',async(req,res)=>res.json({records:await repo.list(req.authSession!.user.id)}));
 r.get('/intake',async(req,res)=>res.json(await repo.intake(req.authSession!.user.id,name(req.query.source),name(req.query.destination))));
 r.post('/issues',async(req,res)=>{const input=warehouseTransferIssueSchema.safeParse(req.body);if(!input.success)throw new HttpError(422,'Check the two warehouses, final item positions and positive transfer quantities.');res.json(await repo.issue(req.authSession!.user.id,input.data));});
 r.post('/receipts',async(req,res)=>{const input=warehouseTransferReceiptSchema.safeParse(req.body);if(!input.success)throw new HttpError(422,'Select the issued transfer, counted evidence and positive destination quantities.');res.json(await repo.receive(req.authSession!.user.id,input.data));});
 r.get('/receipts/:id',async(req,res)=>res.json(await repo.receipt(req.authSession!.user.id,id(req.params.id))));
 r.get('/receipts/:id/document.pdf',async(req,res)=>{const row=await repo.receipt(req.authSession!.user.id,id(req.params.id)),model=warehouseTransferReceiptPrintModel(row);res.locals.downloadContext={documentType:model.title,identity:'warehouse-transfer-receipt:'+row.id,revision:1};res.type('pdf').set('Content-Disposition',`inline; filename="${row.number}.pdf"`).send(materialDocumentPdf(model));});
 r.get('/:id',async(req,res)=>res.json(await repo.detail(req.authSession!.user.id,id(req.params.id))));
 r.get('/:id/document.pdf',async(req,res)=>{const row=await repo.detail(req.authSession!.user.id,id(req.params.id));await requireWarehouseAccess(req.authSession!.user.id,row.sourceWarehouse,pool,true);const model=warehouseTransferPrintModel(row);res.locals.downloadContext={documentType:model.title,identity:'warehouse-transfer:'+row.id,revision:1};res.type('pdf').set('Content-Disposition',`inline; filename="${row.number}.pdf"`).send(materialDocumentPdf(model,warehouseTransferCopies));});
 return r;
}
