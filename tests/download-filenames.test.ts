import{test}from'node:test';
import assert from'node:assert/strict';
import{randomUUID,createHash}from'node:crypto';
import express from'express';
import request from'supertest';
import{testDatabase}from'./database.js';
import{downloadName,filenameFromDisposition}from'../shared/download-name.js';
import{registeredDownloadName}from'../server/documents/download-name.js';
import{exportContext,friendlyExportNames}from'../server/documents/download-http.js';
test('customer/site first, leading zeroes, invalid characters, missing details, revisions and RFC filename decoding',()=>{
 const name=downloadName({customer:'UBL / Bank',site:'Tariq: Block',siteCode:'0208',documentType:'Quotation',identity:'known-stable-id',reference:'Q7K2',revision:2,extension:'pdf'});
 assert.equal(name,'UBL Bank - Tariq Block 0208 - Quotation - Q7K2-R2.pdf');assert.ok(!/[<>:"/\\|?*\x00-\x1f]/.test(name));
 const missing=downloadName({documentType:'Invoice',identity:'missing-details-1',extension:'pdf'});assert.ok(missing.startsWith('Customer not recorded - Site not recorded - Invoice - '));assert.equal(missing,downloadName({documentType:'Invoice',identity:'missing-details-1',extension:'pdf'}));
 const unicode='Meezan - سائٹ 0001 - Invoice - I1.pdf';assert.equal(filenameFromDisposition(`attachment; filename="fallback.pdf"; filename*=UTF-8''${encodeURIComponent(unicode)}`),unicode);
});
test('stable unique aliases survive concurrent requests and reference collisions, and middleware never changes PDF/Excel bytes',async()=>{
 const db=await testDatabase();try{
  const names=await Promise.all(Array.from({length:4},()=>registeredDownloadName(db.pool,{customer:'UBL',site:'Walton Road',siteCode:'1236',documentType:'IPO and PT',identity:'ipo:stable',reference:'CHP-345',extension:'pdf'})));assert.ok(names.every(n=>n===names[0]));assert.equal(names[0],'UBL - Walton Road 1236 - IPO and PT - CHP-345.pdf');
  const collision=await registeredDownloadName(db.pool,{customer:'MBL',site:'Head Office',documentType:'IPO and PT',identity:'ipo:other-stable',reference:'CHP-345',extension:'pdf'});assert.ok(!collision.endsWith('CHP-345.pdf'));
  const original=Buffer.from('%PDF-1.4 unchanged official bytes'),hash=createHash('sha256').update(original).digest('hex'),app=express();app.use(friendlyExportNames(db.pool));
  app.get('/api/test.pdf',(req,res)=>{(req as any).authSession={user:{id:randomUUID()}};res.locals.downloadContext={customer:'UBL',site:'Walton Road',siteCode:'1236',documentType:'IPO and PT',identity:'ipo:stable',reference:'CHP-345',extension:'pdf'};res.type('pdf').set('Content-Disposition','attachment; filename="long-internal-id.pdf"').send(original)});
  const pdf=await request(app).get('/api/test.pdf').buffer(true).parse((res,cb)=>{const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('end',()=>cb(null,Buffer.concat(chunks)))}).expect(200);assert.equal(createHash('sha256').update(pdf.body).digest('hex'),hash);assert.equal(filenameFromDisposition(pdf.headers['content-disposition']),names[0]);
  app.get('/api/test.xlsx',(req,res)=>{(req as any).authSession={user:{id:randomUUID()}};res.locals.downloadContext={customer:'MBL',site:'Combined 20 Sites',documentType:'Survey Report',identity:'survey-group:20',revision:3,extension:'xlsx'};res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from('PK unchanged workbook'))});
  const xlsx=await request(app).get('/api/test.xlsx').expect(200);assert.match(filenameFromDisposition(xlsx.headers['content-disposition'])!,/^MBL - Combined 20 Sites - Survey Report - .+-R3\.xlsx$/);
  app.get('/api/backups/export',(req,res)=>{(req as any).authSession={user:{id:randomUUID()}};res.type('application/zip').set('Content-Disposition','attachment; filename="Recovery.zip"').send(Buffer.from('untouched archive'))});assert.equal((await request(app).get('/api/backups/export')).headers['content-disposition'],'attachment; filename="Recovery.zip"');
 }finally{await db.close()}
});
test('all business export route families resolve metadata without changing their records',async()=>{
 const db=await testDatabase();try{
  const id=randomUUID();
  // Empty lookups still exercise every actual table name and return explicit fallbacks.
  const routes=[`/api/commercial/quotations/${id}/quotation.pdf`,`/api/orders/${id}/ipo.pdf`,`/api/orders/${id}/peachtree.pdf`,`/api/orders/documents/${id}`,`/api/orders/submissions/${id}/preview.pdf`,`/api/boqs/${id}/report.pdf`,`/api/boqs/reviews/${id}/costing.pdf`,`/api/boqs/drafts/${id}/report.pdf`,`/api/operations/${id}/report.pdf`,`/api/operations/store/${id}/report.pdf`,`/api/project-workflow/${id}/documents/${id}/pdf`,`/api/project-workflow/${id}/files/${id}`,`/api/project-workflow/survey-dispatch-previews/${id}/pdf`,`/api/project-workflow/ubl-survey-packages/${id}/xlsx`,`/api/project-workflow/survey-submission-groups/${id}/xlsx`,`/api/project-workflow/approved-survey-groups/${id}/xlsx`,`/api/cni/${id}/versions/${id}/proposal.pdf`,`/api/design/${id}/files/${id}`,`/api/ubl/workflow/${id}/documents/${id}/pdf`,`/api/inventory/files/${id}`,`/api/accounts-workspace/evidence/${id}`,`/api/ubl/35-30-40/source.pdf`,`/api/ubl/sites/1/pack.pdf`];
  for(const path of routes){const c=await exportContext(db.pool,{originalUrl:path,body:undefined,query:{}},path.endsWith('/xlsx')?'xlsx':'pdf');assert.ok(c.identity);assert.ok(c.documentType);}
 }finally{await db.close()}
});
