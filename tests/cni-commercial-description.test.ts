import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {testDatabase} from './database.js';import {MastersRepository} from '../server/masters/repository.js';
import {cniCommercialItem,CNI_COMMERCIAL_ITEM_ID} from '../server/commercial/cni-commercial-description.js';
import {buildCniPdf} from '../server/commercial/cni-report.js';import {priceCni} from '../server/commercial/cni-policy.js';
async function pdfText(bytes:Buffer){const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});try{const pdf=await task.promise;let text='';for(let page=1;page<=pdf.numPages;page++)text+=(await(await pdf.getPage(page)).getTextContent()).items.map((i:any)=>i.str??'').join(' ');return text;}finally{await task.destroy();}}
test('C&I freezes exact cabinet Item ID commercial wording; catalogue revisions never change prior quotation output',async()=>{
 const db=await testDatabase();try{
  const actor=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'Atif','isolated','Coordinator')",[actor,actor+'@example.test']);
  const masters=new MastersRepository(db.pool),prior=await cniCommercialItem(db.pool);assert.equal(prior?.itemId,CNI_COMMERCIAL_ITEM_ID);
  await masters.saveCommercialDescription(actor,CNI_COMMERCIAL_ITEM_ID,prior!.version,'CUSTOMER CABINET WORDING APPROVED IN ITEM DATABASE');
  const frozen=await cniCommercialItem(db.pool),snapshot={customer:{name:'C&I customer',contact_person:'Contact',phone:'',address:'',city:'Lahore',province:'',email:''},siteName:'HQ',validityDays:7,preparedBy:'Atif',issuedDate:'2026-10-15',pricing:priceCni({quantity:2,discount:'500000',taxRate:'18',presentation:'Separate'}),commercialItem:frozen,pdfTemplate:'PHOTON-APPROVED-1'};
  const before=JSON.stringify(snapshot),firstText=await pdfText(buildCniPdf(snapshot,'CNI-TEST-R1',false));assert.match(firstText,/CUSTOMER CABINET WORDING APPROVED IN ITEM DATABASE/);assert.match(firstText,/125 kW/);assert.match(firstText,/261 kWh/);assert.match(firstText,/34,000,000.00/);
  await masters.saveCommercialDescription(actor,CNI_COMMERCIAL_ITEM_ID,frozen!.version,'LATER CATALOGUE WORDING');
  assert.equal(await pdfText(buildCniPdf(snapshot,'CNI-TEST-R1',false)),firstText);assert.equal(JSON.stringify(snapshot),before);
  const next={...snapshot,commercialItem:await cniCommercialItem(db.pool)};assert.match(await pdfText(buildCniPdf(next,'CNI-TEST-R2',false)),/LATER CATALOGUE WORDING/);assert.deepEqual(next.pricing,snapshot.pricing);
  assert.match(await pdfText(buildCniPdf({...next,pdfTemplate:undefined},'CNI-LEGACY-R2',false)),/LATER CATALOGUE WORDING/);
  const long={...next,commercialItem:{...next.commercialItem!,description:('Customer cabinet scope text with warranty and service. '.repeat(28)).slice(0,1500)}};assert.match(await pdfText(buildCniPdf(long,'CNI-LONG-R1',false)),/Total payable/);
 }finally{await db.close();}
});
