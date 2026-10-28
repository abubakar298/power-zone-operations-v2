import {replacementCommittedPrintRecord,replacementDocumentPdf} from './material-replacement-documents.js';
import {warehouseTransferPrintModel,warehouseTransferReceiptPrintModel} from './warehouse-transfer-documents.js';
import {GatePassRepository,gatePassKind,gatePassCopySchema} from './gate-passes.js';
import {Router,type RequestHandler} from 'express';
import {z} from 'zod';
import {equalSecrets} from '../auth/crypto.js';
import {HttpError} from '../http/errors.js';
import {MaterialDraftRepository,materialDraftInputSchema} from './material-drafts.js';
import {SiteMaterialPlanRepository,siteMaterialPlanInputSchema} from './site-material-plans.js';
import {returnReceiptPrintModel,purchaseReceiptPrintModel,siteUsagePrintModel,issuedDispatchPrintModel,parentDraftPrintModel,sitePlanPrintModel} from './material-document-model.js';
import {materialDocumentPdf} from './material-document-pdf.js';

import {MaterialStockRepository,materialIssueInputSchema,materialReceiptInputSchema,materialEvidenceInputSchema} from './material-stock.js';

import {MaterialUsageRepository,materialUsageInputSchema} from './material-usage.js';

import {PurchaseReceivingRepository,purchaseReceiptInputSchema} from './purchase-receiving.js';

const printKind=z.enum(['fixed-do','variable-do','customer-signoff','irr']);
function requireVersion(value:unknown,current:number){const v=z.coerce.number().int().positive().safeParse(value);if(!v.success)throw new HttpError(422,'Select a saved document version.');if(v.data!==current)throw new HttpError(409,'This preparation changed. Refresh before previewing its documents.');}

export function materialDraftHttp(repo:MaterialDraftRepository,requireSession:RequestHandler,sitePlans?:SiteMaterialPlanRepository,stock?:MaterialStockRepository,usage?:MaterialUsageRepository,purchases?:PurchaseReceivingRepository,gates?:GatePassRepository){
 const r=Router();r.use(requireSession);
 r.use((req,_res,next)=>{if(req.method!=='GET'&&!equalSecrets(req.get('X-CSRF-Token')??'',req.authSession!.csrfToken))throw new HttpError(403,'Refresh and try again.');next();});
 if(gates){
  const key=(value:unknown)=>{const parsed=z.uuid().safeParse(value);if(!parsed.success)throw new HttpError(400,'Invalid warehouse document.');return parsed.data;};
  const kind=(value:unknown)=>{const parsed=gatePassKind.safeParse(value);if(!parsed.success)throw new HttpError(400,'Invalid warehouse document type.');return parsed.data;};
  r.get('/access',async(req,res)=>res.json(await gates.access(req.authSession!.user.id)));
  r.get('/gate-passes',async(req,res)=>res.json(await gates.list(req.authSession!.user.id)));
  r.get('/gate-passes/:kind/:id',async(req,res)=>res.json(await gates.detail(req.authSession!.user.id,kind(req.params.kind),key(req.params.id))));
  r.post('/gate-pass-copies',async(req,res)=>{const input=gatePassCopySchema.safeParse(req.body);if(!input.success)throw new HttpError(422,'Select the warehouse document, copy type and signed evidence.');res.json(await gates.attach(req.authSession!.user.id,input.data));});
  r.get('/gate-passes/:kind/:id/document.pdf',async(req,res)=>{const type=kind(req.params.kind),record=await gates.record(req.authSession!.user.id,type,key(req.params.id));if(type==='replacement-out'||type==='replacement-in'){const model=replacementCommittedPrintRecord(record,type);res.locals.downloadContext={documentType:type==='replacement-out'?'Replacement DO':'Faulty return IGP',identity:`gate-pass:${type}:${record.id}`,revision:1};res.type('pdf').set('Content-Disposition',`inline; filename="${record.number}.pdf"`).send(replacementDocumentPdf(model));return;}const model=type==='transfer-out'?warehouseTransferPrintModel(record):type==='transfer-in'?warehouseTransferReceiptPrintModel(record):type==='dispatch'?issuedDispatchPrintModel(record):type==='return'?returnReceiptPrintModel(record):purchaseReceiptPrintModel(record);res.locals.downloadContext={documentType:model.title,identity:`gate-pass:${type}:${record.id}`,revision:1};res.type('pdf').set('Content-Disposition',`inline; filename="${record.number}.pdf"`).send(materialDocumentPdf(model));});
 }
 if(stock){
  const uuid=(value:unknown)=>{const parsed=z.uuid().safeParse(value);if(!parsed.success)throw new HttpError(400,'Invalid warehouse record.');return parsed.data;};
  r.get('/stock',async(req,res)=>{const warehouse=z.string().trim().min(1).max(200).safeParse(req.query.warehouse);if(!warehouse.success)throw new HttpError(422,'Select a warehouse.');res.json(await stock.positions(req.authSession!.user.id,warehouse.data));});
  r.get('/drafts/:id/movements',async(req,res)=>res.json(await stock.movements(req.authSession!.user.id,uuid(req.params.id))));
  r.post('/issues',async(req,res)=>{const input=materialIssueInputSchema.safeParse(req.body);if(!input.success)throw new HttpError(422,'Check the dispatch quantities, receiving person and current warehouse balance.');res.json(await stock.issue(req.authSession!.user.id,input.data));});
  r.post('/receipts',async(req,res)=>{const input=materialReceiptInputSchema.safeParse(req.body);if(!input.success)throw new HttpError(422,'Check the counted return quantities and warehouse receipt evidence.');res.json(await stock.receive(req.authSession!.user.id,input.data));});
  r.post('/evidence',async(req,res)=>{const input=materialEvidenceInputSchema.safeParse(req.body);if(!input.success)throw new HttpError(422,'Upload a PDF, PNG or JPEG warehouse evidence file up to 15 MB.');res.json(await stock.uploadEvidence(req.authSession!.user.id,input.data));});
  r.get('/evidence/:id',async(req,res)=>{const file=await stock.evidence(req.authSession!.user.id,uuid(req.params.id));res.set('Content-Type',file.media_type).set('Content-Disposition',`attachment; filename="Warehouse-evidence-${file.id}.${file.media_type==='application/pdf'?'pdf':file.media_type==='image/png'?'png':'jpg'}"`).send(file.content);});
  r.get('/issued/:id',async(req,res)=>res.json(await stock.dispatch(req.authSession!.user.id,uuid(req.params.id))));
  r.get('/issued/:id/document.pdf',async(req,res)=>{
   const record=await stock.dispatch(req.authSession!.user.id,uuid(req.params.id)),model=issuedDispatchPrintModel(record);
   res.locals.downloadContext={documentType:model.title,identity:`material-dispatch:${record.id}`,revision:1,site:model.sites.map(s=>s.name).join(' - ')};
   res.type('pdf').set('Content-Disposition',`inline; filename="${record.number}.pdf"`).send(materialDocumentPdf(model));
  });
 }
 if(usage){
  const id=(value:unknown)=>{const parsed=z.uuid().safeParse(value);if(!parsed.success)throw new HttpError(400,'Invalid site usage record.');return parsed.data;};
  r.get('/qc/sites/:boardId/evidence/:fileId',async(req,res)=>{const board=z.string().min(1).max(160).parse(req.params.boardId),file=await usage.qcEvidence(req.authSession!.user.id,board,id(req.params.fileId));res.set({'Content-Type':file.media_type,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}).send(file.content);});
  r.get('/qc/sites/:boardId/material-usage',async(req,res)=>{const board=z.string().min(1).max(160).parse(req.params.boardId);res.json(await usage.qcSite(req.authSession!.user.id,board));});
  r.get('/drafts/:id/site-usage',async(req,res)=>res.json(await usage.read(req.authSession!.user.id,id(req.params.id))));
  r.post('/site-usage',async(req,res)=>{const input=materialUsageInputSchema.safeParse(req.body);if(!input.success)throw new HttpError(422,'Check site measurements, evidence references, date and change reason.');res.json(await usage.save(req.authSession!.user.id,input.data));});
  r.get('/drafts/:id/sites/:site/documents/:kind.pdf',async(req,res)=>{
   if(!['customer-signoff','irr'].includes(req.params.kind))throw new HttpError(400,'Select customer sign-off or internal reconciliation.');
   const data=await usage.site(req.authSession!.user.id,id(req.params.id),id(req.params.site));
   if(!data.report)throw new HttpError(409,'Save the site usage report first.');requireVersion(req.query.version,data.report.version);
   const model=siteUsagePrintModel(data,req.params.kind as 'customer-signoff'|'irr');
   res.locals.downloadContext={documentType:model.title,identity:`site-use:${req.params.id}:${req.params.site}:${req.params.kind}`,revision:data.report.version,site:model.sites[0]?.name};
   res.type('pdf').set('Content-Disposition','inline; filename="Site-Usage-Record.pdf"').send(materialDocumentPdf(model));
  });
 }
 if(purchases){
  const id=(value:unknown)=>{const parsed=z.uuid().safeParse(value);if(!parsed.success)throw new HttpError(400,'Invalid purchase receipt record.');return parsed.data;};
  r.get('/purchases/:requestId/receiving',async(req,res)=>{const warehouse=z.string().trim().min(1).max(200).safeParse(req.query.warehouse);if(!warehouse.success)throw new HttpError(422,'Select the receiving warehouse.');res.json(await purchases.intake(req.authSession!.user.id,id(req.params.requestId),warehouse.data));});
  r.post('/purchase-receipts',async(req,res)=>{const input=purchaseReceiptInputSchema.safeParse(req.body);if(!input.success)throw new HttpError(422,'Check the receiving warehouse, final item IDs, quantities and evidence.');res.json(await purchases.receive(req.authSession!.user.id,input.data));});
  r.get('/purchase-receipts/:id/document.pdf',async(req,res)=>{const record=await purchases.receipt(req.authSession!.user.id,id(req.params.id)),model=purchaseReceiptPrintModel(record);res.locals.downloadContext={documentType:model.title,identity:`purchase-receipt:${record.id}`,revision:1};res.type('pdf').set('Content-Disposition',`inline; filename="${record.number}.pdf"`).send(materialDocumentPdf(model));});
 }
 r.get('/minimum-stock',async(req,res)=>res.json(await repo.minimumStock(req.authSession!.user.id,req.query.warehouse)));
 r.post('/minimum-stock',async(req,res)=>res.json(await repo.saveMinimumStock(req.authSession!.user.id,req.body)));
 r.get('/warehouses',async(req,res)=>res.json(await repo.warehouses(req.authSession!.user.id)));
 r.get('/intake',async(req,res)=>res.json(await repo.intake(req.authSession!.user.id)));
 r.get('/drafts',async(req,res)=>res.json(await repo.list(req.authSession!.user.id)));
 r.get('/drafts/:id',async(req,res)=>{const id=z.uuid().safeParse(req.params.id);if(!id.success)throw new HttpError(400,'Invalid material draft.');res.json(await repo.detail(req.authSession!.user.id,id.data));});
 r.get('/drafts/:id/documents/:kind.pdf',async(req,res)=>{
  const id=z.uuid().safeParse(req.params.id),kind=printKind.safeParse(req.params.kind);if(!id.success||!kind.success)throw new HttpError(400,'Invalid material document.');
  const draft=await repo.detail(req.authSession!.user.id,id.data);requireVersion(req.query.version,draft.version);
  const model=parentDraftPrintModel(draft,kind.data,typeof req.query.site==='string'?req.query.site:undefined);
  res.locals.downloadContext={documentType:model.title+' DRAFT',identity:`material-draft:${id.data}:${kind.data}:${req.query.site??'warehouse'}`,revision:draft.version,site:model.sites.map(s=>s.name).join(' - '),customer:draft.snapshot.sites[0]?.customer};
  res.type('pdf').set('Content-Disposition','inline; filename="Material-Document-DRAFT.pdf"').send(materialDocumentPdf(model));
 });
 r.post('/drafts',async(req,res)=>{const input=materialDraftInputSchema.safeParse(req.body);if(!input.success)throw new HttpError(422,'Check the selected sites, item IDs and material quantities. Blank draft quantities are allowed.');res.json(await repo.save(req.authSession!.user.id,input.data));});
 if(sitePlans){
  r.get('/site-plans',async(req,res)=>res.json(await sitePlans.list(req.authSession!.user.id)));
  r.get('/site-plans/:id',async(req,res)=>{const id=z.uuid().safeParse(req.params.id);if(!id.success)throw new HttpError(400,'Invalid site material preparation.');res.json(await sitePlans.detail(req.authSession!.user.id,id.data));});
  r.get('/site-plans/:id/documents/:kind.pdf',async(req,res)=>{
   const id=z.uuid().safeParse(req.params.id),kind=printKind.safeParse(req.params.kind);if(!id.success||!kind.success)throw new HttpError(400,'Invalid site material document.');
   const plan=await sitePlans.detail(req.authSession!.user.id,id.data);requireVersion(req.query.version,plan.version);
   const model=sitePlanPrintModel(plan,kind.data);
   res.locals.downloadContext={documentType:model.title+' DRAFT',identity:`site-material:${id.data}:${kind.data}`,revision:plan.version,site:model.sites[0]?.name,customer:plan.fixed.snapshot.sites[0]?.customer};
   res.type('pdf').set('Content-Disposition','inline; filename="Material-Document-DRAFT.pdf"').send(materialDocumentPdf(model));
  });
  r.post('/site-plans',async(req,res)=>{const input=siteMaterialPlanInputSchema.safeParse(req.body);if(!input.success)throw new HttpError(422,'Check the site, material rows and Parent DO selection. Blank draft quantities are allowed.');res.json(await sitePlans.save(req.authSession!.user.id,input.data));});
 }
 return r;
}
