import {Router,type RequestHandler} from 'express';
import type {Pool} from 'pg';
import {z} from 'zod';
import {equalSecrets} from '../auth/crypto.js';
import {HttpError} from '../http/errors.js';
import {requireWarehouseAccess} from './warehouse-access.js';
import {MaterialStockRepository,materialEvidenceInputSchema} from './material-stock.js';
import {MaterialReplacementsRepository,replacementCaseInputSchema,replacementIssueInputSchema,replacementReturnInputSchema,replacementUsableInputSchema} from './material-replacements.js';
import {replacementDocumentPdf,replacementPrintRecord,type ReplacementDocumentKind} from './material-replacement-documents.js';
const uuid=(v:unknown)=>{const p=z.uuid().safeParse(v);if(!p.success)throw new HttpError(400,'Invalid replacement record.');return p.data;};
const warehouse=(v:unknown)=>{const p=z.string().trim().min(1).max(200).safeParse(v);if(!p.success)throw new HttpError(422,'Select a warehouse.');return p.data;};
const parse=<T,>(schema:z.ZodType<T>,body:unknown)=>{const p=schema.safeParse(body);if(!p.success)throw new HttpError(422,p.error.issues[0]?.message??'Check the replacement details.');return p.data;};
async function access(pool:Pool,actor:string){
 const u=(await pool.query('SELECT role,active FROM users WHERE id=$1',[actor])).rows[0];if(!u?.active)throw new HttpError(401,'Your access has ended.');
 const grants=u.role==='Inventory'?(await pool.query('SELECT warehouse,capability FROM inventory_material_access WHERE user_id=$1 ORDER BY warehouse,capability',[actor])).rows:[];
 const management=['Admin','Management'].includes(u.role),all=management?(await pool.query("SELECT DISTINCT payload->>'warehouse' warehouse FROM inventory_warehouse_source_balances ORDER BY warehouse")).rows.map(r=>r.warehouse):[];
 const enabled=!!(await pool.query("SELECT to_regclass('public.inventory_material_replacement_cases') IS NOT NULL AND to_regclass('public.inventory_material_replacement_usable_releases') IS NOT NULL AS enabled")).rows[0].enabled;
 return{enabled,kind:management?'management':grants.some(r=>r.capability==='dispatcher')?'dispatcher':grants.some(r=>r.capability==='storekeeper')?'storekeeper':'unassigned',issueWarehouses:management?all:[...new Set(grants.filter(r=>r.capability==='dispatcher').map(r=>r.warehouse))],readWarehouses:management?all:[...new Set(grants.map(r=>r.warehouse))]};
}
/** Mount at /api/inventory-replacements after the normal authenticated boundary. */
export function materialReplacementHttp(pool:Pool,requireSession:RequestHandler){
 const r=Router(),repo=new MaterialReplacementsRepository(pool),stock=new MaterialStockRepository(pool);r.use(requireSession);
 r.use((req,_res,next)=>{if(req.method!=='GET'&&!equalSecrets(req.get('X-CSRF-Token')??'',req.authSession!.csrfToken))throw new HttpError(403,'Refresh and try again.');next();});
 const actor=(req:any)=>req.authSession.user.id;
 r.get('/access',async(req,res)=>res.json(await access(pool,actor(req))));
 r.use(async(_req,_res,next)=>{if(!(await pool.query("SELECT to_regclass('public.inventory_material_replacement_usable_releases') IS NOT NULL AS enabled")).rows[0].enabled)throw new HttpError(409,'Replacement records are not enabled in this workspace yet.');next();});
 r.get('/intake',async(req,res)=>{
  const selected=warehouse(req.query.warehouse);await requireWarehouseAccess(actor(req),selected,pool);const scope=await access(pool,actor(req));
  const docs=(await pool.query('SELECT id,number,warehouse,snapshot,created_at FROM inventory_material_dispatches_active WHERE warehouse=ANY($1::text[]) ORDER BY created_at DESC,id LIMIT 500',[scope.issueWarehouses])).rows;
  const allLines=(await pool.query('SELECT dispatch_id,line_key,item_id,unit,description,quantity::text FROM inventory_material_dispatch_lines_active WHERE dispatch_id=ANY($1::uuid[]) ORDER BY dispatch_id,line_key',[docs.map(d=>d.id)])).rows;
  const originals=docs.map(doc=>({id:doc.id,number:doc.number,warehouse:doc.warehouse,date:doc.created_at,sites:(doc.snapshot.sites??[]).map((s:any)=>({siteId:s.siteId,siteName:s.siteName,ipo:s.ipo,orderNumber:s.orderNumber,customer:s.customer})),lines:allLines.filter(l=>l.dispatch_id===doc.id).map(({dispatch_id,...line})=>({...line,siteIds:(doc.snapshot.lines??[]).find((v:any)=>v.key===line.line_key)?.sites??[]}))}));
  res.json({warehouse:selected,originals,stock:await stock.positions(actor(req),selected)});
 });
 r.get('/stock',async(req,res)=>res.json(await stock.positions(actor(req),warehouse(req.query.warehouse))));
 r.get('/cases',async(req,res)=>res.json(await repo.list(actor(req),warehouse(req.query.warehouse))));
 r.get('/cases/:id',async(req,res)=>res.json(await repo.detail(actor(req),uuid(req.params.id))));
 r.post('/cases',async(req,res)=>res.json(await repo.open(actor(req),parse(replacementCaseInputSchema,req.body))));
 r.post('/cases/:id/issue',async(req,res)=>{const input=parse(replacementIssueInputSchema,req.body);if(input.caseId!==uuid(req.params.id))throw new HttpError(422,'The selected replacement case changed.');res.json(await repo.issue(actor(req),input));});
 r.post('/cases/:id/faulty-return',async(req,res)=>{const input=parse(replacementReturnInputSchema,req.body);if(input.caseId!==uuid(req.params.id))throw new HttpError(422,'The selected replacement case changed.');res.json(await repo.receiveFaulty(actor(req),input));});
 r.post('/returns/:id/usable-release',async(req,res)=>{const input=parse(replacementUsableInputSchema,req.body);if(input.returnId!==uuid(req.params.id))throw new HttpError(422,'The selected counted return changed.');res.json(await repo.releaseUsable(actor(req),input));});
 r.post('/evidence',async(req,res)=>res.json(await stock.uploadEvidence(actor(req),parse(materialEvidenceInputSchema,req.body))));
 r.get('/evidence/:id',async(req,res)=>{const file=await stock.evidence(actor(req),uuid(req.params.id));res.locals.downloadContext={documentType:'Replacement warehouse evidence',identity:file.id,revision:1};res.set('Content-Security-Policy','sandbox').set('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`).type(file.media_type).send(file.content);});
 const document=(kind:ReplacementDocumentKind)=>async(req:any,res:any)=>{const record=await replacementPrintRecord(pool,actor(req),kind,uuid(req.params.id));res.locals.downloadContext={documentType:kind==='replacement-out'?'Replacement DO':'Faulty return IGP',identity:kind+':'+record.id,revision:1};res.type('pdf').set('Content-Disposition',`inline; filename="${record.number}.pdf"`).send(replacementDocumentPdf(record));};
 r.get('/out/:id/document.pdf',document('replacement-out'));r.get('/returns/:id/document.pdf',document('replacement-in'));
 return r;
}
