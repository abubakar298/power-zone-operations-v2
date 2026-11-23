import{test}from'node:test';
import assert from'node:assert/strict';
import{randomUUID,createHash}from'node:crypto';
import express from'express';
import request from'supertest';
import type{Pool}from'pg';
import{downloadName,numberedDownloadName,cleanDocumentNumber,filenameFromDisposition}from'../shared/download-name.js';
import{exportContext,friendlyExportNames}from'../server/documents/download-http.js';
import{registeredDownloadName}from'../server/documents/download-name.js';

// Quotation and IPO file names (Atif's request, 23 Nov 2026): "<number> - <customer> - <site name> - <site code>".
test('quotation and IPO names: number first, customer always, site name and code only when recorded',()=>{
 const name=(number:string,site?:string,siteCode?:string,customer='Vigilant Pharma')=>numberedDownloadName({number,customer,site,siteCode,extension:'pdf'});
 assert.equal(name('QT-70-R1','Johar Town','JOHART'),'QT-70-R1 - Vigilant Pharma - Johar Town - JOHART.pdf');
 assert.equal(name('QT-70','Johar Town','JOHART'),'QT-70 - Vigilant Pharma - Johar Town - JOHART.pdf');
 assert.equal(name('QT-71'),'QT-71 - Vigilant Pharma.pdf');
 assert.equal(name('QT-71','Johar Town'),'QT-71 - Vigilant Pharma - Johar Town.pdf');
 assert.equal(name('QT-71',undefined,'JOHART'),'QT-71 - Vigilant Pharma - JOHART.pdf');
 assert.equal(name('QT-71','  ','  '),'QT-71 - Vigilant Pharma.pdf');
 assert.equal(name('IPO-163','Johar Town','JOHART'),'IPO-163 - Vigilant Pharma - Johar Town - JOHART.pdf');
 assert.equal(name('IPO-163-R1','Johar Town','JOHART'),'IPO-163-R1 - Vigilant Pharma - Johar Town - JOHART.pdf');
 // A code that is the same as the site name is not repeated.
 assert.equal(name('QT-72','7870','7870','BAFL'),'QT-72 - BAFL - 7870.pdf');
 // Missing customer is stated, never left as an empty part.
 assert.equal(numberedDownloadName({number:'QT-73',extension:'pdf'}),'QT-73 - Customer not recorded.pdf');
 // Characters Windows refuses are removed; no doubled separators or spaces.
 const odd=name('QT-74','Block: A / "North"','A-1',' UBL <Bank> | Ltd? ');
 assert.equal(odd,'QT-74 - UBL Bank Ltd - Block A North - A-1.pdf');assert.ok(!/[\\/:*?"<>|]/.test(odd));assert.ok(!/ - - |  /.test(odd));
 // Older CPZ numbers lose the " (SHORT-SITE)" tail; typed IPO numbers stay as saved (minus refused characters).
 assert.equal(cleanDocumentNumber('CPZ-QT-26-012-0005-003-R1 (UBL-0208)'),'CPZ-QT-26-012-0005-003-R1');
 assert.equal(cleanDocumentNumber('QT-70-R1'),'QT-70-R1');
 assert.equal(cleanDocumentNumber('CHP-345 (shared)'),'CHP-345 (shared)');
 assert.equal(name('CHP-345','Walton Road','1236','UBL'),'CHP-345 - UBL - Walton Road - 1236.pdf');
 assert.equal(name('213/250','Walton Road','1236','UBL'),'213 250 - UBL - Walton Road - 1236.pdf');
 // The format only applies when a number is known; other files keep the existing name.
 assert.equal(downloadName({customer:'UBL',site:'Walton Road',documentType:'IPO and PT',identity:'x',reference:'IPO-9',revision:2,extension:'pdf',format:'numbered'}),'IPO-9 - UBL - Walton Road.pdf');
 assert.equal(downloadName({customer:'UBL',customerName:'United Bank Limited',site:'Walton Road',documentType:'IPO and PT',identity:'x',reference:'IPO-9',extension:'pdf',format:'numbered'}),'IPO-9 - United Bank Limited - Walton Road.pdf');
 assert.match(downloadName({customer:'UBL',site:'Walton Road',documentType:'IPO and PT',identity:'draft',extension:'pdf',format:'numbered'}),/^UBL - Walton Road - IPO and PT - /);
 assert.equal(downloadName({customer:'UBL',site:'Walton Road',siteCode:'1236',documentType:'Survey Report',identity:'x',reference:'Q7K2',revision:2,extension:'xlsx'}),'UBL - Walton Road 1236 - Survey Report - Q7K2-R2.xlsx');
});

/** Answers exportContext's lookups from fixed rows; any other query fails the test. */
function fakePool(tables:Record<string,any>,customers:Record<string,{name:string;short_code:string}>={}){
 return{query:async(sql:string,params:any[])=>{
  const table=sql.match(/FROM (\w+) t WHERE id::text=ANY/)?.[1];
  if(table){const value=tables[table];return{rows:value&&params[0].includes(value.id)?[{value}]:[]};}
  if(/FROM customers WHERE id=\$1/.test(sql)){const c=customers[String(params[0])];return{rows:c?[c]:[]};}
  throw Error('Unexpected query: '+sql);
 }} as unknown as Pool;
}
const quotation=(number:string,version:number,snapshot:any)=>({id:randomUUID(),number,version,snapshot});
async function contextName(pool:Pool,path:string,originalName=''){return downloadName({...await exportContext(pool,{originalUrl:path,body:undefined,query:{}},'pdf',originalName),extension:'pdf'});}

test('saved quotation and final C&I quotation downloads use the number, full customer name, site name and code',async()=>{
 const snapshot={customer:{id:7,name:'Vigilant Pharma',shortCode:'5519'},siteName:'Johar Town',siteCode:'JOHART'};
 // The first quotation is QT-70 (version 1); earlier names wrongly added "-R1" from the version count.
 const first=quotation('QT-70',1,snapshot);
 assert.equal(await contextName(fakePool({quotation_versions:first}),`/api/commercial/quotations/${first.id}/quotation.pdf`,'QT-70-quotation.pdf'),'QT-70 - Vigilant Pharma - Johar Town - JOHART.pdf');
 const revised=quotation('QT-70-R1',2,snapshot);
 assert.equal(await contextName(fakePool({quotation_versions:revised}),`/api/commercial/quotations/${revised.id}/quotation.pdf`),'QT-70-R1 - Vigilant Pharma - Johar Town - JOHART.pdf');
 const old=quotation('CPZ-QT-26-012-0005-003-R1 (5519-JOHART)',1,snapshot);
 assert.equal(await contextName(fakePool({quotation_versions:old}),`/api/commercial/quotations/${old.id}/quotation.pdf`),'CPZ-QT-26-012-0005-003-R1 - Vigilant Pharma - Johar Town - JOHART.pdf');
 // Customer name looked up when the snapshot holds only the id.
 const bare=quotation('QT-71',1,{customer:{id:7},siteName:'Johar Town',siteCode:'JOHART'});
 assert.equal(await contextName(fakePool({quotation_versions:bare},{'7':{name:'Vigilant Pharma',short_code:'5519'}}),`/api/commercial/quotations/${bare.id}/quotation.pdf`),'QT-71 - Vigilant Pharma - Johar Town - JOHART.pdf');
 // The revision comparison sheet is not the quotation and keeps its existing name.
 assert.match(await contextName(fakePool({quotation_versions:revised}),`/api/commercial/quotations/${revised.id}/comparison.pdf`),/^5519 - Johar Town JOHART - Quotation - /);
 // C&I: the approved proposal is named like a quotation; a draft keeps its DRAFT name.
 const cni={id:randomUUID(),customer_id:9,number:'QT-80',version:1,snapshot:{customer:{id:9,name:'Gul Ahmed Textile',short_code:'GATM'},siteName:'Landhi Plant',siteCode:'LANDHI'}};
 const proposal=randomUUID();
 assert.equal(await contextName(fakePool({cni_proposal_versions:cni}),`/api/cni/${proposal}/versions/${cni.id}/proposal.pdf`,'QT-80.pdf'),'QT-80 - Gul Ahmed Textile - Landhi Plant - LANDHI.pdf');
 assert.match(await contextName(fakePool({cni_proposal_versions:cni}),`/api/cni/${proposal}/versions/${cni.id}/proposal.pdf`,'QT-80-DRAFT.pdf'),/ - Quotation DRAFT - /);
});

test('IPO download header uses the new name without an alias lookup and leaves the PDF bytes unchanged',async()=>{
 const noQueries={query:async(sql:string)=>{throw Error('Unexpected query: '+sql)}} as unknown as Pool;
 assert.equal(await registeredDownloadName(noQueries,{customer:'5519',customerName:'Vigilant Pharma',site:'Johar Town',siteCode:'JOHART',documentType:'IPO and PT',identity:'internal_purchase_orders:x',reference:'IPO-163-R1',extension:'pdf',format:'numbered'}),'IPO-163-R1 - Vigilant Pharma - Johar Town - JOHART.pdf');
 const original=Buffer.from('%PDF-1.4 unchanged IPO bytes'),app=express();app.use(friendlyExportNames(noQueries));
 app.get('/api/orders/x/ipo.pdf',(req,res)=>{(req as any).authSession={user:{id:randomUUID()}};res.locals.downloadContext={customer:'5519',customerName:'Vigilant Pharma',site:'Johar Town',siteCode:'JOHART',documentType:'IPO and PT',identity:'internal_purchase_orders:x',reference:'IPO-163',extension:'pdf',format:'numbered'};res.type('pdf').set('Content-Disposition','attachment; filename="IPO-163-IPO-and-Peachtree.pdf"').send(original)});
 const pdf=await request(app).get('/api/orders/x/ipo.pdf').buffer(true).parse((res,cb)=>{const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('end',()=>cb(null,Buffer.concat(chunks)))}).expect(200);
 assert.equal(filenameFromDisposition(pdf.headers['content-disposition']),'IPO-163 - Vigilant Pharma - Johar Town - JOHART.pdf');
 assert.equal(createHash('sha256').update(pdf.body).digest('hex'),createHash('sha256').update(original).digest('hex'));
});
