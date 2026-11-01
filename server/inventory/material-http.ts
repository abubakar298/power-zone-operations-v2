import {savedSiteIssueSchema} from './site-material-issuance.js';
import {materialDocumentPolicy} from '../../shared/material-documents.js';
import closingReviewed from './closing-reviewed-source.json' with {type:'json'};
import {replacementCommittedPrintRecord,replacementDocumentPdf} from './material-replacement-documents.js';
import {warehouseTransferPrintModel,warehouseTransferReceiptPrintModel,warehouseTransferCopies} from './warehouse-transfer-documents.js';
import {GatePassRepository,gatePassKind,gatePassCopySchema} from './gate-passes.js';
import {Router,type RequestHandler} from 'express';
import {z} from 'zod';
import {equalSecrets} from '../auth/crypto.js';
import {HttpError} from '../http/errors.js';
import {MaterialDraftRepository,materialDraftInputSchema} from './material-drafts.js';
import {SiteMaterialPlanRepository,siteMaterialPlanInputSchema} from './site-material-plans.js';
import {issuedCustomerSignoffModels,returnWorksheetPrintModel,returnReceiptPrintModel,purchaseReceiptPrintModel,siteUsagePrintModel,issuedDispatchPrintModel,parentDraftPrintModel,sitePlanPrintModel} from './material-document-model.js';
import {materialDocumentPdf,parentDoCopies,warehouseDoCopies} from './material-document-pdf.js';

import {MaterialStockRepository,materialIssueInputSchema,materialReceiptInputSchema,materialEvidenceInputSchema} from './material-stock.js';

import {MaterialUsageRepository,materialUsageInputSchema} from './material-usage.js';

import {PurchaseReceivingRepository,purchaseReceiptInputSchema} from './purchase-receiving.js';

const printKind=z.enum(['fixed-do','variable-do','customer-signoff','irr']);
function requireVersion(value:unknown,current:number){const v=z.coerce.number().int().positive().safeParse(value);if(!v.success)throw new HttpError(422,'Select a saved document version.');if(v.data!==current)throw new HttpError(409,'This preparation changed. Refresh before previewing its documents.');}

export function materialDraftHttp(repo:MaterialDraftRepository,requireSession:RequestHandler,sitePlans?:SiteMaterialPlanRepository,stock?:MaterialStockRepository,usage?:MaterialUsageRepository,purchases?:PurchaseReceivingRepository,gates?:GatePassRepository){
 const r=Router();r.use(requireSession);
 r.get('/material-corrections',async(req,res)=>res.json(await repo.correctionAlerts(req.authSession!.user.id)));
 r.get('/document-status',async(req,res)=>res.json(await repo.documentStatus(req.authSession!.user.id)));
 r.get('/document-status/:id/evidence/:file',async(req,res)=>{const file=await repo.documentEvidence(req.authSession!.user.id,z.uuid().parse(req.params.id),z.uuid().parse(req.params.file));res.set({'Content-Type':file.media_type,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}).send(file.content);});
 r.get('/closing-reviewed',async(req,res)=>{const scope=await repo.warehouses(req.authSession!.user.id);res.json({...closingReviewed,rows:closingReviewed.rows.filter(row=>scope.warehouses.includes(row.warehouse))});});
 r.use((req,_res,next)=>{if(req.method!=='GET'&&!equalSecrets(req.get('X-CSRF-Token')??'',req.authSession!.csrfToken))throw new HttpError(403,'Refresh and try again.');next();});
 if(gates){
  const key=(value:unknown)=>{const parsed=z.uuid().safeParse(value);if(!parsed.success)throw new HttpError(400,'Invalid warehouse document.');return parsed.data;};
  const kind=(value:unknown)=>{const parsed=gatePassKind.safeParse(value);if(!parsed.success)throw new HttpError(400,'Invalid warehouse document type.');return parsed.data;};
  r.get('/access',async(req,res)=>res.json(await gates.access(req.authSession!.user.id)));
  r.get('/gate-passes',async(req,res)=>res.json(await gates.list(req.authSession!.user.id)));
  r.get('/gate-passes/:kind/:id',async(req,res)=>res.json(await gates.detail(req.authSession!.user.id,kind(req.params.kind),key(req.params.id))));
  r.post('/gate-pass-copies',async(req,res)=>{const input=gatePassCopySchema.safeParse(req.body);if(!input.success)throw new HttpError(422,'Select the warehouse document, copy type and signed evidence.');res.json(await gates.attach(req.authSession!.user.id,input.data));});
  r.get('/gate-passes/:kind/:id/document.pdf',async(req,res)=>{const type=kind(req.params.kind),record=await gates.record(req.authSession!.user.id,type,key(req.params.id));if(type==='replacement-out'||type==='replacement-in'){const model=replacementCommittedPrintRecord(record,type);res.locals.downloadContext={documentType:type==='replacement-out'?'Replacement DO':'Faulty return IGP',identity:`gate-pass:${type}:${record.id}`,revision:1};res.type('pdf').set('Content-Disposition',`inline; filename="${record.number}.pdf"`).send(replacementDocumentPdf(model));return;}const model=type==='transfer-out'?warehouseTransferPrintModel(record):type==='transfer-in'?warehouseTransferReceiptPrintModel(record):type==='dispatch'?issuedDispatchPrintModel(record):type==='return'?returnReceiptPrintModel(record):purchaseReceiptPrintModel(record);if(type==='dispatch'&&stock)model.acknowledgements=await stock.acknowledgements(req.authSession!.user.id,record.id);if(req.query.format==='model'){res.json(model);return;}res.locals.downloadContext={documentType:model.title,identity:`gate-pass:${type}:${record.id}`,revision:1};res.type('pdf').set('Content-Disposition',`inline; filename="${record.number}.pdf"`).send(materialDocumentPdf(model,type==='transfer-out'?warehouseTransferCopies:type==='dispatch'&&model.parentDispatch?parentDoCopies:undefined));});
 }
 if(stock){
  r.post('/drafts/:id/issue-saved',async(req,res)=>{const input=savedSiteIssueSchema.omit({partialDelivery:true}).safeParse(req.body);if(!input.success)throw new HttpError(422,'Check the saved Parent DO version and note.');res.json(await repo.issueSaved(req.authSession!.user.id,z.uuid().parse(req.params.id),input.data,stock));});
  r.get('/stock-overview',async(req,res)=>res.json(await stock.overview(req.authSession!.user.id)));
  r.get('/stock-ledger',async(req,res)=>res.json(await stock.ledger(req.authSession!.user.id,req.query)));
  const uuid=(value:unknown)=>{const parsed=z.uuid().safeParse(value);if(!parsed.success)throw new HttpError(400,'Invalid warehouse record.');return parsed.data;};
  r.get('/stock',async(req,res)=>{const warehouse=z.string().trim().min(1).max(200).safeParse(req.query.warehouse);if(!warehouse.success)throw new HttpError(422,'Select a warehouse.');res.json(await stock.positions(req.authSession!.user.id,warehouse.data));});
  r.get('/drafts/:id/movements',async(req,res)=>res.json(await stock.movements(req.authSession!.user.id,uuid(req.params.id))));
  r.post('/issues',async(req,res)=>{const input=materialIssueInputSchema.safeParse(req.body);if(!input.success)throw new HttpError(422,'Check the dispatch quantities, receiving person and current warehouse balance.');res.json(await stock.issue(req.authSession!.user.id,input.data));});
  r.post('/receipts',async(req,res)=>{const input=materialReceiptInputSchema.safeParse(req.body);if(!input.success)throw new HttpError(422,'Check the counted return quantities and warehouse receipt evidence.');res.json(await stock.receive(req.authSession!.user.id,input.data));});
  r.post('/evidence',async(req,res)=>{const input=materialEvidenceInputSchema.safeParse(req.body);if(!input.success)throw new HttpError(422,'Upload a PDF, PNG or JPEG warehouse evidence file up to 15 MB.');res.json(await stock.uploadEvidence(req.authSession!.user.id,input.data));});
  r.get('/evidence/:id',async(req,res)=>{const file=await stock.evidence(req.authSession!.user.id,uuid(req.params.id));res.set('Content-Type',file.media_type).set('Content-Disposition',`attachment; filename="Warehouse-evidence-${file.id}.${file.media_type==='application/pdf'?'pdf':file.media_type==='image/png'?'png':'jpg'}"`).send(file.content);});
  r.get('/issued/:id/customer-signoff.pdf',async(req,res)=>{
   const record=await stock.dispatch(req.authSession!.user.id,uuid(req.params.id)),models=issuedCustomerSignoffModels(record),siteId=typeof req.query.site==='string'?z.uuid().parse(req.query.site):undefined;
   if(record.snapshot.parent&&!siteId)throw new HttpError(422,'Select the site for its Parent DO sign-off.');
   const model=siteId?models.find(m=>m.sourceSiteId===siteId):models[0];
   if(!model)throw new HttpError(404,'This site has no issued variable items on this DO.');
   if(req.query.format==='model'){res.json(model);return;}
   res.locals.downloadContext={documentType:model.title,identity:`material-signoff:${record.id}:${model.sourceSiteId}`,revision:1,site:model.sites[0]?.name};
   res.type('pdf').send(materialDocumentPdf(model));
  });
  r.get('/drafts/:id/customer-signoffs',async(req,res)=>{
   const draft=await repo.detail(req.authSession!.user.id,uuid(req.params.id));
   if(!draft.snapshot.parent)throw new HttpError(422,'Select a Parent DO for batch sign-off download.');
   const record=await stock.dispatch(req.authSession!.user.id,z.uuid().parse(req.query.dispatch));
   if(record.draft_id!==draft.id)throw new HttpError(404,'This DO does not belong to the selected preparation.');
   const documents=issuedCustomerSignoffModels(record);
   if(!documents.length)throw new HttpError(404,'This Parent DO has no variable-item sign-offs.');
   res.json({documents});
  });
  r.get('/issued/:id/edit',async(req,res)=>res.json(await stock.unsignedDoDetail(req.authSession!.user.id,uuid(req.params.id))));
  r.post('/issued/:id/revise',async(req,res)=>res.json(await stock.unsignedDoChange(req.authSession!.user.id,uuid(req.params.id),req.body)));
  r.get('/issued/:id',async(req,res)=>res.json(await stock.dispatch(req.authSession!.user.id,uuid(req.params.id))));
  r.get('/issued/:id/document.pdf',async(req,res)=>{
   const record=await stock.dispatch(req.authSession!.user.id,uuid(req.params.id)),model=issuedDispatchPrintModel(record);
   model.acknowledgements=await stock.acknowledgements(req.authSession!.user.id,record.id);
   if(req.query.format==='model'){res.json(model);return;}
   res.locals.downloadContext={documentType:model.title,identity:`material-dispatch:${record.id}`,revision:1,site:model.sites.map(s=>s.name).join(' - ')};
   res.type('pdf').set('Content-Disposition',`inline; filename="${record.number}.pdf"`).send(materialDocumentPdf(model,model.parentDispatch?parentDoCopies:undefined));
  });
 }
 if(usage){
  const id=(value:unknown)=>{const parsed=z.uuid().safeParse(value);if(!parsed.success)throw new HttpError(400,'Invalid site usage record.');return parsed.data;};
  r.get('/qc/sites/:boardId/evidence/:fileId',async(req,res)=>{const board=z.string().min(1).max(160).parse(req.params.boardId),file=await usage.qcEvidence(req.authSession!.user.id,board,id(req.params.fileId));res.set({'Content-Type':file.media_type,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}).send(file.content);});
  r.get('/qc/sites/:boardId/material-usage',async(req,res)=>{const board=z.string().min(1).max(160).parse(req.params.boardId);res.json(await usage.qcSite(req.authSession!.user.id,board));});
  r.get('/qc/sites/:boardId/historical-usage',async(req,res)=>res.json(await usage.historicalQcSite(req.authSession!.user.id,z.string().min(1).max(160).parse(req.params.boardId))));
  r.post('/qc/sites/:boardId/historical-usage',async(req,res)=>res.json(await usage.saveHistoricalQcSite(req.authSession!.user.id,z.string().min(1).max(160).parse(req.params.boardId),req.body)));
  r.get('/drafts/:id/return-worksheet.pdf',async(req,res)=>{const data=await usage.read(req.authSession!.user.id,id(req.params.id));requireVersion(req.query.version,data.draft.version);const model=returnWorksheetPrintModel(data);res.locals.downloadContext={documentType:model.title,identity:'return-worksheet:'+data.draft.id,revision:data.draft.version};res.type('pdf').set('Content-Disposition','inline; filename="Return-IGP-count-sheet.pdf"').send(materialDocumentPdf(model));});
  r.get('/drafts/:id/site-usage',async(req,res)=>res.json(await usage.read(req.authSession!.user.id,id(req.params.id))));
  r.post('/site-usage',async(req,res)=>{const input=materialUsageInputSchema.safeParse(req.body);if(!input.success)throw new HttpError(422,'Check site measurements, evidence references, date and change reason.');res.json(await usage.save(req.authSession!.user.id,input.data));});
  r.get('/drafts/:id/sites/:site/documents/:kind.pdf',async(req,res)=>{
   if(!['customer-signoff','irr'].includes(req.params.kind))throw new HttpError(400,'Select customer sign-off or internal reconciliation.');
   const data=await usage.site(req.authSession!.user.id,id(req.params.id),id(req.params.site));
   if(!data.report)throw new HttpError(409,'Save the site usage report first.');requireVersion(req.query.version,data.report.version);
   const model=siteUsagePrintModel(data,req.params.kind as 'customer-signoff'|'irr');
   if(req.query.format==='model'){res.json(model);return;}
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
 r.get('/parent-reviewed-ledger',async(req,res)=>res.json(await repo.reviewedPools(req.authSession!.user.id)));
 r.get('/drafts/:id/reconciliation',async(req,res)=>res.json(await repo.parentReconciliation(req.authSession!.user.id,z.uuid().parse(req.params.id))));
 r.get('/drafts/:id/return-ledger',async(req,res)=>res.json(await repo.returnLedger(req.authSession!.user.id,z.uuid().parse(req.params.id))));
 r.post('/return-reconciliation',async(req,res)=>res.json(await repo.changeReturnReconciliation(req.authSession!.user.id,req.body)));
 r.post('/parent-reconciliation',async(req,res)=>res.json(await repo.changeParentReconciliation(req.authSession!.user.id,req.body)));
 r.get('/site-ledger-history',async(req,res)=>res.json(await repo.siteLedger(req.authSession!.user.id)));
 r.get('/transport-choices',async(req,res)=>{const warehouse=z.string().trim().min(1).max(200).parse(req.query.warehouse);res.json(await repo.transportChoices(req.authSession!.user.id,warehouse));});
 r.post('/transport-choices',async(req,res)=>res.json(await repo.saveTransportChoice(req.authSession!.user.id,req.body)));
 r.get('/drafts/:id/history',async(req,res)=>{const id=z.uuid().parse(req.params.id);res.json(await repo.history(req.authSession!.user.id,id));});
 r.get('/site-plans/:id/history',async(req,res)=>{if(!sitePlans)throw new HttpError(404,'Site preparation unavailable.');const id=z.uuid().parse(req.params.id),plan=await sitePlans.detail(req.authSession!.user.id,id),fixed=await repo.history(req.authSession!.user.id,plan.fixed.id);res.json(fixed);});
 r.get('/temporary-documents',async(req,res)=>res.json(await repo.temporaryDocuments(req.authSession!.user.id)));
 r.post('/temporary-documents',async(req,res)=>res.json(await repo.saveTemporaryDocument(req.authSession!.user.id,req.body)));
 r.get('/intake',async(req,res)=>res.json(await repo.intake(req.authSession!.user.id)));
 r.get('/drafts',async(req,res)=>res.json(await repo.list(req.authSession!.user.id)));
 r.get('/drafts/:id',async(req,res)=>{const id=z.uuid().safeParse(req.params.id);if(!id.success)throw new HttpError(400,'Invalid material draft.');res.json(await repo.detail(req.authSession!.user.id,id.data));});
 r.get('/drafts/:id/documents/:kind.pdf',async(req,res)=>{
  const id=z.uuid().safeParse(req.params.id),kind=printKind.safeParse(req.params.kind);if(!id.success||!kind.success)throw new HttpError(400,'Invalid material document.');
  const draft=await repo.detail(req.authSession!.user.id,id.data);requireVersion(req.query.version,draft.version);
  const model=parentDraftPrintModel(draft,kind.data,typeof req.query.site==='string'?req.query.site:undefined);
  if(req.query.format==='model'){res.json(model);return;}
  res.locals.downloadContext={documentType:model.title+' DRAFT',identity:`material-draft:${id.data}:${kind.data}:${req.query.site??'warehouse'}`,revision:draft.version,site:model.sites.map(s=>s.name).join(' - '),customer:draft.snapshot.sites[0]?.customer};
  res.type('pdf').set('Content-Disposition','inline; filename="Material-Document-DRAFT.pdf"').send(materialDocumentPdf(model));
 });
 r.post('/drafts',async(req,res)=>{const input=materialDraftInputSchema.safeParse(req.body);if(!input.success)throw new HttpError(422,'Check the selected sites, item IDs and material quantities. Blank draft quantities are allowed.');res.json(await repo.save(req.authSession!.user.id,input.data));});
 if(sitePlans){
  if(stock)r.post('/site-plans/:id/issue',async(req,res)=>{const id=z.uuid().parse(req.params.id),input=savedSiteIssueSchema.safeParse(req.body);if(!input.success)throw new HttpError(422,'Check the saved preparation version, partial delivery choice and issuance note.');res.json(await sitePlans.issueSaved(req.authSession!.user.id,id,input.data,stock));});
  r.get('/site-plans/:id/issued',async(req,res)=>res.json(await sitePlans.issued(req.authSession!.user.id,z.uuid().parse(req.params.id))));
  r.get('/site-plans',async(req,res)=>res.json(await sitePlans.list(req.authSession!.user.id)));
  r.get('/site-plans/:id',async(req,res)=>{const id=z.uuid().safeParse(req.params.id);if(!id.success)throw new HttpError(400,'Invalid site material preparation.');res.json(await sitePlans.detail(req.authSession!.user.id,id.data));});
  r.get('/site-plans/:id/documents/:kind.pdf',async(req,res)=>{
   const id=z.uuid().safeParse(req.params.id),kind=printKind.safeParse(req.params.kind);if(!id.success||!kind.success)throw new HttpError(400,'Invalid site material document.');
   const plan=await sitePlans.detail(req.authSession!.user.id,id.data);requireVersion(req.query.version,plan.version);
   const model=sitePlanPrintModel(plan,kind.data);
   if(req.query.format==='model'){res.json(model);return;}
   res.locals.downloadContext={documentType:model.title+' DRAFT',identity:`site-material:${id.data}:${kind.data}`,revision:plan.version,site:model.sites[0]?.name,customer:plan.fixed.snapshot.sites[0]?.customer};
   res.type('pdf').set('Content-Disposition','inline; filename="Material-Document-DRAFT.pdf"').send(materialDocumentPdf(model));
  });
  r.post('/site-plans',async(req,res)=>{const input=siteMaterialPlanInputSchema.safeParse(req.body);if(!input.success)throw new HttpError(422,'Check the site, material rows and Parent DO selection. Blank draft quantities are allowed.');res.json(await sitePlans.save(req.authSession!.user.id,input.data));});
 }
 return r;
}
