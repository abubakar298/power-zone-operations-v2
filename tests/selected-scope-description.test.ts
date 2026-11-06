import{test}from'node:test';import assert from'node:assert/strict';
import{selectedScopeDescription}from'../server/commercial/selected-scope-description.js';
const selection={brand:'Jinko / Longi',watts:'620',structure:'Elevated',panels:32};
test('panel and structure catalogue templates resolve from the exact selected BOQ facts',()=>{
 assert.equal(selectedScopeDescription('solar','Brand to be confirmed 620 W Solar PV Modules',selection),'Jinko / Longi 620 W Solar PV Modules');
 assert.equal(selectedScopeDescription('structure','{Selected structure type} Solar Mounting Structure for PV Array — for {panel quantity} panels',selection),'Elevated Solar Mounting Structure for PV Array — for 32 panels');
 assert.equal(selectedScopeDescription('solar','{Solar brand} {panel wattage} W modules',selection),'Jinko / Longi 620 W modules');
 assert.equal(selectedScopeDescription('solar','Solar PV Modules',selection),'Jinko / Longi 620 W Solar PV Modules');
 assert.equal(selectedScopeDescription('solar','Jinko 645 N-Type Bi-Facial Tier 1 Solar Modules',{...selection,brand:'Jinko',watts:'645'}),'Jinko 645 N-Type Bi-Facial Tier 1 Solar Modules');
 assert.equal(selectedScopeDescription('solar','Brand to be confirmed 585 W Solar PV Modules',selection),'Jinko / Longi 620 W Solar PV Modules');
 assert.equal(selectedScopeDescription('solar','Catalogue wording',{...selection,specification:'Selected all-black module'}),'Jinko / Longi 620 W Selected all-black module');
});
import{randomUUID}from'node:crypto';import{writeFileSync}from'node:fs';
import{testDatabase}from'./database.js';import{MastersRepository}from'../server/masters/repository.js';import{calculate}from'../server/boq/engine.js';import{surveySchema}from'../server/boq/schema.js';import{price,quote}from'../server/commercial/engine.js';import{pricingSchema,quotationSchema}from'../server/commercial/schema.js';import{quotationDisplayRows}from'../server/commercial/quotation-rows.js';import{buildQuotationPdf}from'../server/commercial/report.js';
test('all quotation layouts retain selected panel/structure facts, amounts and explicit customer edits',async()=>{
 const db=await testDatabase();try{
  const m=await new MastersRepository(db.pool).list(),brand=(category:string,name:string)=>m.brands.find((b:any)=>b.category===category&&b.name===name)!.id;
  for(const structure of ['L1','Elevated']){
   const survey=surveySchema.parse({customerId:3,siteName:'Sample selected-scope branch',siteCode:'SAMPLE-SCOPE',location:'Lahore',panelQty:32,panelWattage:'620',structure,dcMetres:'100',earth25:'20',earth6:'30',earth10:'40',inverter:'20 kW',batteryKwh:30,smartMeter:false,genset:false,brands:{solar:brand('Solar Panel','Any of the Above'),inverter:brand('Inverter','Chint Power'),battery:brand('Battery & BMS','Chint Power'),cable:brand('Cable','Newage Cables'),switchgear:brand('Switchgear','CHINT')},preparedBy:'Sample Coordinator'});
   const boq=calculate(survey,m),before=JSON.stringify(boq),templated={...boq,lines:boq.lines.map(l=>({...l,commercialDescription:l.key==='Solar PV Modules'?'Brand to be confirmed 620 W Solar PV Modules':l.phase==='Structure'?'{Selected structure type} Solar Mounting Structure for PV Array — for {panel quantity} panels':undefined}))};
   for(const presentation of ['No Breakup','Basic Breakup','Full Breakup'])for(const taxMode of ['Tax Included','Show Sales Tax Separately']){
    const pi=pricingSchema.parse({boqRevisionId:randomUUID(),presentation,taxMode,markups:{solar:'20',structure:'20',bess:'15',earthing:'20',balance:'20',rest:'20'},discount:'0',preparedBy:'Sample Coordinator'}),pricing=price(boq,'SAMPLE-BOQ',pi),qi=quotationSchema.parse({pricingId:randomUUID(),quotedDate:'2026-10-31',validity:'7 Days',proposedBy:'Sample Coordinator'}),base=quote(pricing,boq,qi),result=quote(pricing,templated,qi);
    assert.match(result.lines[0].description,/620 W/);assert.match(result.lines[0].description,new RegExp(boq.selectedBrands.solar.alternatives[0]));assert.doesNotMatch(result.lines[0].description,/Brand to be confirmed/);assert.ok(result.lines[1].description.startsWith(structure+' '));assert.match(result.lines[1].description,/for 32 panels/);assert.doesNotMatch(result.lines[1].description,/\{/);
    assert.deepEqual(result.footer,base.footer);assert.deepEqual(result.lines.map(l=>[l.qty,l.unit,l.amount]),base.lines.map(l=>[l.qty,l.unit,l.amount]));assert.doesNotMatch(quotationDisplayRows(result.lines)[1].description,/\{/);
    const oldDescriptions=result.lines.slice(0,result.scopeCount).map(l=>l.description);oldDescriptions[0]='Brand to be confirmed 620 W Solar PV Modules';oldDescriptions[1]='{Selected structure type} Solar Mounting Structure for PV Array - for {panel quantity} panels for 50 panels';const refreshed=quote(pricing,templated,{...qi,descriptions:oldDescriptions});assert.doesNotMatch(refreshed.lines[0].description,/Brand to be confirmed/);assert.ok(refreshed.lines[1].description.startsWith(structure+' '));assert.match(refreshed.lines[1].description,/for 32 panels$/);assert.doesNotMatch(refreshed.lines[1].description,/\{|panels for/);
    const descriptions=result.lines.slice(0,result.scopeCount).map(l=>l.description);descriptions[0]='Customer-approved panel wording';descriptions[1]='Customer-approved mounting wording';const edited=quote(pricing,templated,{...qi,descriptions});assert.equal(edited.lines[0].description,descriptions[0]);assert.equal(quotationDisplayRows(edited.lines)[1].description,descriptions[1]);
    if(structure==='Elevated'&&presentation==='Full Breakup'&&taxMode==='Show Sales Tax Separately')writeFileSync('/tmp/pz-selected-scope-quotation.pdf',buildQuotationPdf(result,'SAMPLE-R1'));
   }
   assert.equal(JSON.stringify(boq),before);
  }
 }finally{await db.close();}
});
