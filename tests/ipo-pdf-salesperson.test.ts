import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {buildIpoPdf} from '../server/orders/document-renderers.js';

// Owner-approved (20 Nov 2026): new IPOs (layout v5) print the salesperson. Issued IPOs keep their saved
// layout version, so a v4 or older IPO prints exactly as before, without the new row.
const snapshot=(documentLayoutVersion:number)=>({documentLayoutVersion,quotationNumber:'QT-TEST',siteName:'Test Branch',siteCode:'0001',customer:{name:'Test Customer'},
 quotationType:{presentation:'Basic Breakup',taxMode:'Tax Included',saleType:'Cash Deal'},
 input:{invoiceCompany:'Energy Solutions',poNumber:'PO-1',orderDate:'2026-11-20',salesPerson:'Waqas ul Haq',salesSource:'Existing customer',paymentMode:'Cash'},
 allocation:{policy:'proportional',subtotal:'1000.00',tax:'0.00',total:'1000.00',lines:[{description:'Inverter',qty:'1',unit:'No.',group:'bess',rate:'1000.00',beforeTax:'1000.00',tax:'0.00',total:'1000.00'}]}});
async function text(pdf:Buffer){
 const doc=await getDocument({data:new Uint8Array(pdf),useSystemFonts:true}).promise;let all='';
 for(let n=1;n<=doc.numPages;n++)all+=(await (await doc.getPage(n)).getTextContent()).items.map((i:any)=>i.str).join(' ')+'\n';
 return all;
}

test('a new (v5) IPO prints the salesperson next to the sales source',async()=>{
 const t=await text(buildIpoPdf(snapshot(5),'CHP-TEST',undefined,{includePt:false}));
 assert.match(t,/Salesperson\s+Waqas ul Haq/);assert.match(t,/Sales source\s+Existing customer/);
});

test('issued v4 and older IPOs print exactly as before, with no salesperson row',async()=>{
 for(const version of [4,3]){
  const t=await text(buildIpoPdf(snapshot(version),'CHP-TEST',undefined,{includePt:false}));
  assert.doesNotMatch(t,/Salesperson/,`layout ${version}`);assert.match(t,/Sales source\s+Existing customer/,`layout ${version}`);
 }
});

test('a new IPO without a saved salesperson has no empty row',async()=>{
 const s=snapshot(5);s.input.salesPerson='';
 assert.doesNotMatch(await text(buildIpoPdf(s,'CHP-TEST',undefined,{includePt:false})),/Salesperson/);
});
