import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {materialDocumentSamples} from '../scripts/fixtures/material-document-samples.js';
import {issuedDispatchPrintModel,parentDraftPrintModel,sitePlanPrintModel,simulatedMaterialPrintModel} from '../server/inventory/material-document-model.js';
import {materialDocumentPdf} from '../server/inventory/material-document-pdf.js';
async function pages(bytes:Buffer){const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});try{const pdf=await task.promise,output:string[]=[];for(let n=1;n<=pdf.numPages;n++)output.push((await(await pdf.getPage(n)).getTextContent()).items.map((i:any)=>i.str??'').join(' '));return output;}finally{await task.destroy();}}
test('customer, warehouse and internal documents preserve their different evidence boundaries without stock postings',()=>{
 const {plan,parent,dispatch,siteA,models}=materialDocumentSamples();
 assert.equal(models['material-fixed-do-preview'].rows.length,2,'Earthing work is fixed BOQ evidence, not an item physically dispatched from stock.');
 const irr=sitePlanPrintModel(plan,'irr');assert.ok(irr.rows.some(r=>r.itemId==='CH-Earthing'));assert.ok(irr.rows.some(r=>r.description==='16mm lugs'));assert.ok(!irr.rows.some(r=>r.itemId.includes('CH-CBL')));
 const customer=models['parent-site-customer-signoff-simulation'];assert.equal(customer.rows.length,1);assert.equal(customer.rows[0].issued,'20');assert.equal(customer.rows[0].used,'20');assert.equal(customer.rows[0].returned,null);assert.equal(customer.stockPosting,false);
 const misc=models['parent-site-internal-irr-simulation'].rows[0];assert.equal(misc.issued,'23');assert.equal(misc.used,'20');assert.equal(misc.returned,'3');
 assert.equal(models['parent-variable-dispatch-preview'].rows[0].issued,'70','The site sign-off cannot repeat the parent warehouse quantity.');
 const deferred={...plan,variableSupply:'parent-do'};assert.throws(()=>sitePlanPrintModel(deferred,'variable-do'),/assigned to a Parent DO/);assert.equal(sitePlanPrintModel(deferred,'customer-signoff').rows[0].issued,null);
 assert.equal(parentDraftPrintModel(parent,'customer-signoff',siteA).rows[0].issued,null);assert.throws(()=>parentDraftPrintModel(parent,'customer-signoff','wrong-site'),/does not belong/);
 assert.throws(()=>parentDraftPrintModel(parent,'fixed-do'),/individual site/);
 const delivery={...plan,fixed:{...plan.fixed,snapshot:{...plan.fixed.snapshot,sites:[{...plan.fixed.snapshot.sites[0],installation:false}]}}};assert.throws(()=>sitePlanPrintModel(delivery,'irr'),/Delivery-only/);
 const unknown={...dispatch,usage:dispatch.usage.filter(v=>v.siteId!==siteA)};assert.equal(simulatedMaterialPrintModel(unknown,'customer-signoff',siteA).rows[0].used,null);
});
test('rendered PDFs identify drafts/simulations, omit financial source fields and keep the customer sign-off free of internal return rows',async()=>{
 const {plan,models}=materialDocumentSamples();(plan.fixed.snapshot as any).privateRate='CONFIDENTIAL-RATE-DO-NOT-PRINT';
 const draftText=(await pages(materialDocumentPdf(sitePlanPrintModel(plan,'fixed-do')))).join(' ');assert.match(draftText,/DRAFT - NOT ISSUED/);assert.match(draftText,/SAMPLE-CUSTOMER-PO-A/);assert.match(draftText,/15kW hybrid inverter/);assert.doesNotMatch(draftText,/CONFIDENTIAL|Earthing Bore/);
 const customer=(await pages(materialDocumentPdf(models['parent-site-customer-signoff-simulation']))).join(' ');assert.match(customer,/SIMULATION - NOT AN ISSUED DOCUMENT/);assert.match(customer,/16mm2 AC cable/);assert.doesNotMatch(customer,/16mm lugs|Returned/);
 const internal=(await pages(materialDocumentPdf(models['parent-site-internal-irr-simulation']))).join(' ');assert.match(internal,/16mm lugs/);assert.doesNotMatch(internal,/16mm2 AC cable/);assert.match(internal,/Warehouse return verified by/);
});
test('long descriptions paginate with repeatable primary headers and a footer on every page',async()=>{
 const model=materialDocumentSamples().models['parent-site-internal-irr-simulation'];model.rows=Array.from({length:65},(_,i)=>({itemId:'CH-LONG-'+i,description:'A long physical material specification with colour and installation information. '.repeat(3),unit:'piece',issued:String(i+1),used:null,returned:null,group:'Miscellaneous'}));
 const result=await pages(materialDocumentPdf(model));assert.ok(result.length>2);result.forEach((p,i)=>{assert.equal(p.match(/Installation Reconciliation Report/g)?.length,1,'The page header must not be drawn twice by separate tables.');assert.match(p,/SIMULATION - NOT AN ISSUED DOCUMENT/);assert.match(p,new RegExp(`Page ${i+1} of ${result.length}`));});assert.match(result.join(' '),/CH-LONG-64/);
});

test('issued warehouse copies require committed state and preserve the posted dispatch quantities',async()=>{
 const parent=materialDocumentSamples().parent;
 const record={id:parent.id,number:'CPZ-PDO-26-TEST',created_at:'2026-10-27T12:00:00Z',snapshot:{...parent.snapshot,status:'issued',stockPosting:true,transport:{issuedTo:'Fictional custodian',vehicle:'TEST-VEHICLE',driver:'Test driver'}}};
 const model=issuedDispatchPrintModel(record);assert.equal(model.rows[0].issued,'70');assert.equal(model.status,'issued');assert.equal(model.stockPosting,true);
 const text=(await pages(materialDocumentPdf(model))).join(' ');assert.match(text,/ISSUED - WAREHOUSE DISPATCH/);assert.match(text,/CPZ-PDO-26-TEST/);assert.match(text,/Fictional custodian/);assert.doesNotMatch(text,/DRAFT - NOT ISSUED|SIMULATION/);
 assert.throws(()=>issuedDispatchPrintModel({...record,snapshot:{...record.snapshot,status:'draft',stockPosting:false}}),/committed warehouse dispatch/);
});

test('purchase IGP prints committed final IDs and received quantities without purchase costs or site headings',async()=>{
 const {purchaseReceiptPrintModel}=await import('../server/inventory/material-document-model.js');
 const record={id:'fixture',number:'CPZ-IGP-26-TEST',warehouse:'Lahore warehouse',created_at:'2026-10-27T12:00:00Z',snapshot:{stockPosting:true,purchaseRequest:{number:'PR-FICTIONAL'},rate:'PRIVATE-PURCHASE-RATE',lines:[{itemId:'CH-CBL-AC-16MM/4C-PK',description:'16mm AC cable',unit:'m',quantity:'4'}]}};
 const model=purchaseReceiptPrintModel(record);assert.equal(model.rows[0].issued,'4');assert.equal(model.status,'received');
 const text=(await pages(materialDocumentPdf(model))).join(' ');assert.match(text,/RECEIVED - WAREHOUSE IN/);assert.match(text,/PR-FICTIONAL/);assert.match(text,/CH-CBL-AC-16MM/);assert.doesNotMatch(text,/PRIVATE-PURCHASE-RATE|0 sites|Customer PO/);
 assert.throws(()=>purchaseReceiptPrintModel({...record,snapshot:{...record.snapshot,stockPosting:false}}),/committed warehouse receipt/);
});

test('material PDF quantities show at most two decimals without changing the source values',async()=>{
 const model=materialDocumentSamples().models['parent-site-internal-irr-simulation'];model.rows[0]={...model.rows[0],issued:'1.234567',used:'1.230000',returned:null};
 const text=(await pages(materialDocumentPdf(model))).join(' ');assert.match(text,/1\.23/);assert.doesNotMatch(text,/1\.234567|1\.230000/);assert.equal(model.rows[0].issued,'1.234567');
});
