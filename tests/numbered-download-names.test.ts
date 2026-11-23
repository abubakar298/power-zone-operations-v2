import{test}from'node:test';
import assert from'node:assert/strict';
import{randomUUID,createHash}from'node:crypto';
import express from'express';
import request from'supertest';
import type{Pool}from'pg';
import{downloadName,numberedDownloadName,cleanDocumentNumber,filenameFromDisposition}from'../shared/download-name.js';
import{exportContext,friendlyExportNames}from'../server/documents/download-http.js';
import{registeredDownloadName}from'../server/documents/download-name.js';
import{printDownloadDetails}from'../server/inventory/print-download-name.js';

// One file name structure for every download (user request, 23 Nov 2026): "<number> - <customer> - <site name> - <site code>".
test('number first, customer always, site name and site code only when recorded',()=>{
 const name=(number:string,site?:string,siteCode?:string,customer='Vigilant Pharma')=>numberedDownloadName({number,customer,site,siteCode,extension:'pdf'});
 assert.equal(name('QT-70-R1','Johar Town','JOHART'),'QT-70-R1 - Vigilant Pharma - Johar Town - JOHART.pdf');
 assert.equal(name('QT-70','Johar Town','JOHART'),'QT-70 - Vigilant Pharma - Johar Town - JOHART.pdf');
 assert.equal(name('QT-71'),'QT-71 - Vigilant Pharma.pdf');
 assert.equal(name('QT-71','Johar Town'),'QT-71 - Vigilant Pharma - Johar Town.pdf');
 assert.equal(name('QT-71',undefined,'JOHART'),'QT-71 - Vigilant Pharma - JOHART.pdf');
 assert.equal(name('QT-71','  ','  '),'QT-71 - Vigilant Pharma.pdf');
 assert.equal(name('IPO-163-R1','Johar Town','JOHART'),'IPO-163-R1 - Vigilant Pharma - Johar Town - JOHART.pdf');
 // A code that is the same as the site name is not repeated.
 assert.equal(name('QT-72','7870','7870','BAFL'),'QT-72 - BAFL - 7870.pdf');
 assert.equal(numberedDownloadName({number:'QT-73',extension:'pdf'}),'QT-73 - Customer not recorded.pdf');
 // Characters Windows refuses are removed; no doubled separators or spaces.
 const odd=name('QT-74','Block: A / "North"','A-1',' UBL <Bank> | Ltd? ');
 assert.equal(odd,'QT-74 - UBL Bank Ltd - Block A North - A-1.pdf');assert.ok(!/[\\/:*?"<>|]/.test(odd));assert.ok(!/ - - |  /.test(odd));
 // Older CPZ numbers lose the " (SHORT-SITE)" tail; typed numbers stay as saved (minus refused characters).
 assert.equal(cleanDocumentNumber('CPZ-QT-26-012-0005-003-R1 (UBL-0208)'),'CPZ-QT-26-012-0005-003-R1');
 assert.equal(cleanDocumentNumber('CHP-345 (shared)'),'CHP-345 (shared)');
 assert.equal(name('213/250','Walton Road','1236','UBL'),'213 250 - UBL - Walton Road - 1236.pdf');
});

test('every document type: own number alone for main documents, number plus type for companions, type plus alias without a number',()=>{
 const base={customer:'UBL',customerName:'United Bank Limited',site:'Walton Road',siteCode:'1236',identity:'x',extension:'pdf'};
 const name=(documentType:string,reference?:string,extra:object={})=>downloadName({...base,documentType,reference,...extra});
 for(const [type,number] of [['Quotation','QT-70'],['IPO and PT','IPO-163'],['IPO','IPO-163'],['BOQ','BOQ-1003'],['Delivery Order','DO-55'],['Invoice','INV-12']])
  assert.equal(name(type,number),`${number} - United Bank Limited - Walton Road - 1236.pdf`,type);
 // Version counters never add -R to a number (the old "QT-70-R1" for a first quotation).
 assert.equal(name('Quotation','QT-70',{revision:1}),'QT-70 - United Bank Limited - Walton Road - 1236.pdf');
 assert.equal(name('PT Breakup','IPO-163'),'IPO-163 PT Breakup - United Bank Limited - Walton Road - 1236.pdf');
 assert.equal(name('Revision Comparison','QT-70-R1'),'QT-70-R1 Revision Comparison - United Bank Limited - Walton Road - 1236.pdf');
 assert.equal(name('Fixed Material Delivery Order','DO-55'),'DO-55 Fixed Material Delivery Order - United Bank Limited - Walton Road - 1236.pdf');
 assert.equal(name('Quotation DRAFT','QT-80'),'QT-80 DRAFT - United Bank Limited - Walton Road - 1236.pdf');
 assert.equal(name('Costing Review Preview','BOQ-9'),'BOQ-9 Costing Review Preview - United Bank Limited - Walton Road - 1236.pdf');
 // Without a number: type and stable alias; version 1 has no suffix, version 3 is -R2.
 assert.equal(name('Evidence',undefined,{alias:'EAB12CD34'}),'Evidence EAB12CD34 - United Bank Limited - Walton Road - 1236.pdf');
 assert.equal(name('Survey Report',undefined,{alias:'SAB12CD34',revision:1,extension:'xlsx'}),'Survey Report SAB12CD34 - United Bank Limited - Walton Road - 1236.xlsx');
 assert.equal(name('Survey Report',undefined,{alias:'SAB12CD34',revision:3}),'Survey Report SAB12CD34-R2 - United Bank Limited - Walton Road - 1236.pdf');
 // Short code used when the full name is unknown.
 assert.equal(downloadName({customer:'UBL',site:'Walton Road',documentType:'IPO',identity:'x',reference:'IPO-9',extension:'pdf'}),'IPO-9 - UBL - Walton Road.pdf');
 // Inventory print models: their own number and single customer; preparation references are not numbers.
 assert.deepEqual(printDownloadDetails({reference:'DO-55',sites:[{customer:'UBL'},{customer:'UBL'}]}),{reference:'DO-55',customer:'UBL'});
 assert.deepEqual(printDownloadDetails({reference:'Preparation 1f2e / v2',sites:[{customer:'UBL'},{customer:'MBL'}]}),{});
});

/** Answers exportContext's lookups from fixed rows; any other query fails the test. */
function fakePool(tables:Record<string,any>,customers:Record<string,{name:string;short_code:string}>={}){
 return{query:async(sql:string,params:any[])=>{
  const table=sql.match(/FROM (\w+) t WHERE id::text=ANY/)?.[1];
  if(table){const value=tables[table];return{rows:value&&params[0].includes(value.id)?[{value}]:[]};}
  if(/FROM customers WHERE id=\$1/.test(sql)){const c=customers[String(params[0])];return{rows:c?[c]:[]};}
  if(/FROM customers WHERE lower\(short_code\)/.test(sql)){const c=Object.values(customers).find(c=>c.short_code.toLowerCase()===String(params[0]).toLowerCase());return{rows:c?[c]:[]};}
  throw Error('Unexpected query: '+sql);
 }} as unknown as Pool;
}
const quotation=(number:string,version:number,snapshot:any)=>({id:randomUUID(),number,version,snapshot});
async function contextName(pool:Pool,path:string,originalName=''){return downloadName({...await exportContext(pool,{originalUrl:path,body:undefined,query:{}},'pdf',originalName),extension:'pdf'});}

test('quotation, C&I and comparison downloads resolve number, full customer name, site name and code',async()=>{
 const snapshot={customer:{id:7,name:'Vigilant Pharma',shortCode:'5519'},siteName:'Johar Town',siteCode:'JOHART'};
 // The first quotation is QT-70 (version 1); the old name wrongly added "-R1" from the version count.
 const first=quotation('QT-70',1,snapshot);
 assert.equal(await contextName(fakePool({quotation_versions:first}),`/api/commercial/quotations/${first.id}/quotation.pdf`,'QT-70-quotation.pdf'),'QT-70 - Vigilant Pharma - Johar Town - JOHART.pdf');
 const revised=quotation('QT-70-R1',2,snapshot);
 assert.equal(await contextName(fakePool({quotation_versions:revised}),`/api/commercial/quotations/${revised.id}/quotation.pdf`),'QT-70-R1 - Vigilant Pharma - Johar Town - JOHART.pdf');
 assert.equal(await contextName(fakePool({quotation_versions:revised}),`/api/commercial/quotations/${revised.id}/comparison.pdf`),'QT-70-R1 Revision Comparison - Vigilant Pharma - Johar Town - JOHART.pdf');
 const old=quotation('CPZ-QT-26-012-0005-003-R1 (5519-JOHART)',1,snapshot);
 assert.equal(await contextName(fakePool({quotation_versions:old}),`/api/commercial/quotations/${old.id}/quotation.pdf`),'CPZ-QT-26-012-0005-003-R1 - Vigilant Pharma - Johar Town - JOHART.pdf');
 const bare=quotation('QT-71',1,{customer:{id:7},siteName:'Johar Town',siteCode:'JOHART'});
 assert.equal(await contextName(fakePool({quotation_versions:bare},{'7':{name:'Vigilant Pharma',short_code:'5519'}}),`/api/commercial/quotations/${bare.id}/quotation.pdf`),'QT-71 - Vigilant Pharma - Johar Town - JOHART.pdf');
 const cni={id:randomUUID(),customer_id:9,number:'QT-80',version:1,snapshot:{customer:{id:9,name:'Gul Ahmed Textile',short_code:'GATM'},siteName:'Landhi Plant',siteCode:'LANDHI'}};
 const proposal=randomUUID();
 assert.equal(await contextName(fakePool({cni_proposal_versions:cni}),`/api/cni/${proposal}/versions/${cni.id}/proposal.pdf`,'QT-80.pdf'),'QT-80 - Gul Ahmed Textile - Landhi Plant - LANDHI.pdf');
 assert.equal(await contextName(fakePool({cni_proposal_versions:cni}),`/api/cni/${proposal}/versions/${cni.id}/proposal.pdf`,'QT-80-DRAFT.pdf'),'QT-80 DRAFT - Gul Ahmed Textile - Landhi Plant - LANDHI.pdf');
});

test('download header: short code becomes the full customer name, numbered files need no alias, PDF bytes unchanged',async()=>{
 const customers={'7':{name:'Vigilant Pharma',short_code:'5519'}};
 assert.equal(await registeredDownloadName(fakePool({}),{customer:'5519',customerName:'Vigilant Pharma',site:'Johar Town',siteCode:'JOHART',documentType:'IPO and PT',identity:'internal_purchase_orders:x',reference:'IPO-163-R1',extension:'pdf'}),'IPO-163-R1 - Vigilant Pharma - Johar Town - JOHART.pdf');
 const original=Buffer.from('%PDF-1.4 unchanged IPO bytes'),app=express();app.use(friendlyExportNames(fakePool({},customers)));
 app.get('/api/orders/x/peachtree.pdf',(req,res)=>{(req as any).authSession={user:{id:randomUUID()}};res.locals.downloadContext={customer:'5519',site:'Johar Town',siteCode:'JOHART',documentType:'PT Breakup',identity:'internal_purchase_orders:x',reference:'IPO-163',extension:'pdf'};res.type('pdf').set('Content-Disposition','attachment; filename="IPO-163-PT.pdf"').send(original)});
 const pdf=await request(app).get('/api/orders/x/peachtree.pdf').buffer(true).parse((res,cb)=>{const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('end',()=>cb(null,Buffer.concat(chunks)))}).expect(200);
 assert.equal(filenameFromDisposition(pdf.headers['content-disposition']),'IPO-163 PT Breakup - Vigilant Pharma - Johar Town - JOHART.pdf');
 assert.equal(createHash('sha256').update(pdf.body).digest('hex'),createHash('sha256').update(original).digest('hex'));
});
