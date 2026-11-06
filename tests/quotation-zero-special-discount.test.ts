import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {buildQuotationPdf,buildQuotationComparisonPdf} from '../server/commercial/report.js';

async function pdfText(bytes:Buffer){
 const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});
 const doc=await task.promise;let text='';
 for(let page=1;page<=doc.numPages;page++)text+=(await(await doc.getPage(page)).getTextContent()).items.map((i:any)=>i.str??'').join(' ');
 await task.destroy();return text;
}
test('quotation PDFs omit zero special discount across formats and preserve positive discounts and saved snapshots',async()=>{
 for(const presentation of ['No Breakup','Basic Breakup','Full Breakup'])for(const included of [false,true])for(const requested of ['0','2500','5000','6000']){
  const snapshot:any={customer:{name:'PDF display test'},input:{quotedDate:'2026-10-15',proposedBy:'Atif',validity:'7 Days'},subject:'Solar solution',siteName:'Test site',siteCode:'0001',solutionId:'TEST',boqNumber:'TEST-BOQ',presentation,lines:[],notes:[],terms:[],discountAuthorization:{preapprovedBeforeTax:'5000',requestedBeforeTax:requested},footer:[{label:included?'Total':'Subtotal Before Tax',amount:'100000'},{label:'Special Discount',amount:requested},{label:'Net Total',amount:String(100000-Number(requested))}]};
  const original=JSON.stringify(snapshot),text=await pdfText(buildQuotationPdf(snapshot,'TEST-R1'));
  assert.equal(text.includes('Management Special Discount'),Number(requested)>5000);
  assert.match(text,/Approved Discount/);assert.ok(text.includes((100000-Number(requested)).toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2})));
  assert.equal(JSON.stringify(snapshot),original);
  if(requested==='0')assert.doesNotMatch(await pdfText(buildQuotationComparisonPdf([{snapshot,label:presentation}],'TEST-R1')),/Management Special Discount/);
 }
});
