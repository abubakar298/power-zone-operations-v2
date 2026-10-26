import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {buildCniPdf} from '../server/commercial/cni-report.js';
import {priceCni} from '../server/commercial/cni-policy.js';
const snapshot={customer:{name:'Test Customer',contact_person:'Contact',phone:'',address:'',city:'Lahore',province:'',email:''},siteName:'HQ',validityDays:7,preparedBy:'Coordinator',issuedDate:'2026-10-09'};
async function pages(data:Buffer){const task=getDocument({data:new Uint8Array(data),useSystemFonts:true});const pdf=await task.promise;const result=[];for(let i=1;i<=pdf.numPages;i++)result.push((await (await pdf.getPage(i)).getTextContent()).items.map((x:any)=>x.str??'').join(' '));await task.destroy();return result;}
test('new C&I template preserves approved content, tax presentation and historical renderer',async()=>{
 for(const presentation of ['Inclusive','Separate'] as const){
 const pricing=priceCni({quantity:1,discount:'500000',taxRate:'18',presentation});
 const s={...snapshot,pricing};const before=JSON.stringify(s);
 const compressed=buildCniPdf({...s,pdfTemplate:'PHOTON-APPROVED-1'},'CPZ-QT-26-003-0003-001-R1 (TEST-HQ)',false);
 assert.ok(compressed.length<2_000_000,`Sharing PDF too large: ${compressed.length}`);
 const modern=await pages(compressed);
 assert.equal(modern.length,6);assert.match(modern[0],/1 CABINET\b/);assert.doesNotMatch(modern[0],/1 CABINETS/);
 assert.match(modern[1],/Best Regards/);assert.match(modern[1],/Abu Bakar Siddique/);assert.match(modern[1],/YOUR PROPOSED SYSTEM/);
 assert.match(modern[2],/1000 x 1400 x 2400 mm/);assert.match(modern[2],/battery rack/);assert.match(modern[2],/BAU-CPS ES-125kW\/261kWh/);assert.match(modern[2],/EMS\s+Local operation monitoring/);
 assert.match(modern[3],/Management-approved discount/);assert.match(modern[3],/Special discount/);assert.doesNotMatch(modern[3],/Standard discount/i);assert.match(modern[3],/18,112,500.00/);assert.match(modern[3],/862,500.00/);assert.match(modern[3],/500,000.00/);assert.match(modern[3],/16,750,000.00/);
 if(presentation==='Separate')assert.match(modern[3],/GST 18%/);else assert.doesNotMatch(modern[3],/GST|Tax/);
 assert.match(modern[5],/COMMERCIAL TERMS CONTINUED/);assert.match(modern[5],/Service item/);assert.match(modern[5],/PCS - 3 Years/);assert.match(modern[5],/Power Zone Service Hotline/);
 const legacy=await pages(buildCniPdf(s,'OLD-QUOTE',false));assert.match(legacy[1],/Prepared by: Coordinator/);assert.doesNotMatch(legacy[1],/YOUR PROPOSED SYSTEM/);
 assert.equal(JSON.stringify(s),before);
 }
});
