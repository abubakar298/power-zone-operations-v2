import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {calculateDirectProducts} from '../server/boq/direct-products.js';
import {price,quote} from '../server/commercial/engine.js';
import {surveySchema} from '../server/boq/schema.js';
import {pricingSchema} from '../server/commercial/schema.js';
import type {Masters} from '../server/boq/engine.js';
const panel='CH-Solar Plate J590',other='Extra Smart Meter';
function fixture(){
 const m:Masters={customers:[{id:1,name:'Panel tax fixture',short_code:'TAX',status:'Active'}],brands:[],rules:[],inverters:[],classifications:[],items:[panel,other].map(key=>({key,approved_specification:key,status:'Approved',version:1})),rates:[panel,other].map(key=>({key,unit:'NOS',rate:'1000',version:1,status:'Approved',notes:''})),catalogue:[{item_id:panel,version:1,rate_key:panel,payload:{itemId:panel,technicalDescription:'590 W module',commercialDescription:'PV module',category:'Solar PV Modules',itemGroup:'Solar Panels',brandCategory:'Jinko',unit:'NOS',itemType:'Stock item',status:'Mapped',reviewNotes:''}}]};
 const s=surveySchema.parse({family:'direct-product',customerId:1,siteName:'Tax fixture',siteCode:'TEST',location:'',panelQty:0,panelWattage:'0',structure:'L1',dcMetres:'0',earth25:'0',earth6:'0',earth10:'0',inverter:'Products',batteryKwh:0,brands:{},smartMeter:false,genset:false,preparedBy:'Fixture',directProducts:[{kind:'item',key:panel,qty:'1'}]});
 return {m,s,policy:{version:1,markups:{solar:'10',structure:'10',earthing:'10',bess:'30',other:'25'},itemCategories:{[panel]:'solar' as const,[other]:'other' as const}}};
}
test('single stock-ID panel quotation uses 10% GST and keeps tax-included presentation correct',()=>{
 const{m,s,policy}=fixture();const boq=calculateDirectProducts(s,m);assert.equal(boq.lines[0].phase,'Solar Panels');
 for(const taxMode of ['Tax Included','Show Sales Tax Separately'] as const){const input=pricingSchema.parse({boqRevisionId:randomUUID(),presentation:'Full Breakup',saleType:'Tax Deal',taxMode,preparedBy:'Fixture'}),p=price(boq,'TEST',input,policy),q=quote(p,boq,{pricingId:randomUUID(),quotedDate:'2026-10-19',validity:'7 days',proposedBy:'Fixture'});
 assert.equal(p.solarTax,'110.00');assert.equal(p.otherTax,'0.00');assert.equal(p.total,'1210.00');assert.equal(p.itemPricing![0].taxRate,'10');assert.equal(q.lines[0].group,'solar');assert.equal(q.lines[0].amount,taxMode==='Tax Included'?'1210.00':'1100.00');assert(!q.footer.some(r=>r.label.includes('18%')));
 }
});
test('old direct-product BOQs reprice panels correctly without rewriting their saved cost or phase',()=>{
 const{m,s,policy}=fixture(),boq=calculateDirectProducts(s,m),legacy={...boq,lines:boq.lines.map(l=>({...l,phase:'EPC'})),summary:[{name:'Solar Panels',cost:'0',perWatt:'0'},{name:'BESS',cost:'0',perWatt:'0'},{name:'EPC',cost:'1000',perWatt:'0'}]};
 const p=price(legacy,'OLD',pricingSchema.parse({boqRevisionId:randomUUID(),presentation:'Full Breakup',saleType:'Tax Deal',taxMode:'Show Sales Tax Separately',preparedBy:'Fixture'}),policy);
 assert.equal(p.solarTax,'110.00');assert.equal(p.otherTax,'0.00');assert.equal(p.rows.find(r=>r.key==='solar')!.cost,'1000');assert.equal(legacy.lines[0].phase,'EPC');assert.equal(legacy.summary[0].cost,'0');
});
test('mixed direct sale keeps other products at 18% and does not tax cash deals',()=>{
 const{m,s,policy}=fixture(),boq=calculateDirectProducts({...s,directProducts:[...s.directProducts!,{kind:'item',key:other,qty:'1'}]},m);
 const pi=pricingSchema.parse({boqRevisionId:randomUUID(),presentation:'Full Breakup',saleType:'Tax Deal',taxMode:'Show Sales Tax Separately',preparedBy:'Fixture'}),p=price(boq,'MIX',pi,policy);
 assert.equal(p.solarTax,'110.00');assert.equal(p.otherTax,'225.00');assert.equal(p.total,'2685.00');
 const cash=price(boq,'CASH',{...pi,saleType:'Cash Deal',cashGstTreatment:'No GST added'},policy);assert.equal(cash.tax,'0.00');assert.equal(cash.total,'2350.00');
});
