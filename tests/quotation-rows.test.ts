import {test} from 'node:test';
import assert from 'node:assert/strict';
import {quotationDisplayRows} from '../server/commercial/quotation-rows.js';
import type {QuoteLine} from '../server/commercial/engine.js';
test('individual scope rows retain grouped amounts and extend merged cells across expanded rows',()=>{
 const lines:QuoteLine[]=[{description:'BESS',unit:'No.',qty:'1',group:'bess',amount:'100.00',span:2},{description:'Battery',unit:'No.',qty:'2',group:'bess'}, {description:'EPC',unit:'LS',qty:'1',group:'balance',amount:'30.00',items:[{description:'Cable',qty:'20',unit:'Metre'},{description:'Breaker',qty:'1',unit:'Each'}]}];
 const before=JSON.stringify(lines),rows=quotationDisplayRows(lines);
 assert.equal(rows.length,4);assert.equal(rows[0].span,2);assert.equal(rows[2].span,2);
 assert.deepEqual(rows.map(r=>[r.description,r.qty,r.unit]),[['BESS','1','No.'],['Battery','2','No.'],['Cable','20','MTRS'],['Breaker','1','Each']]);
 assert.equal(rows.reduce((sum,r)=>sum+Number(r.amount??0),0),130);
 assert.equal(JSON.stringify(lines),before);
});
test('older saved multiline quotations display quantities in their own columns without changing history',()=>{
 const lines:QuoteLine[]=[{description:'Cable (10 Metre)\nBreaker (1 Each)',unit:'LS',qty:'1',group:'balance',amount:'123.45'}];
 const rows=quotationDisplayRows(lines);assert.deepEqual(rows.map(r=>[r.description,r.qty,r.unit]),[['Cable','10','MTRS'],['Breaker','1','Each']]);assert.equal(rows[0].amount,'123.45');assert.equal(rows[0].span,2);
});

test('new full-breakup scope gives each cable row its exact selling amount and retains offer totals',()=>{
 const lines:QuoteLine[]=[{description:'AC cables',group:'balance',qty:'1',unit:'LS',amount:'60.00',items:[{description:'Inverter termination',qty:'10',unit:'m',amount:'20.00',offerAllowance:'1.00'},{description:'Load panel termination',qty:'20',unit:'m',amount:'40.00',offerAllowance:'2.00'}]}];
 const original=JSON.stringify(lines),base=quotationDisplayRows(lines);assert.deepEqual(base.map(l=>l.amount),['20.00','40.00']);assert(base.every(l=>l.span===1));
 const offer=quotationDisplayRows([{...lines[0],amount:'63.01'}]);assert.deepEqual(offer.map(l=>l.amount),['21.00','42.01']);assert.equal(JSON.stringify(lines),original);
});

test('customer quote UOMs use MTRS for cables and one JOB for complete installation and delivery',()=>{
 const lines:QuoteLine[]=[{description:'Cable',unit:'m',qty:'15',group:'balance',amount:'1500.00'},{description:'Installation, Testing & Commissioning Labour',unit:'Inverter',qty:'2',group:'balance',amount:'100000.00'},{description:'Project Delivery / Logistics',unit:'Project',qty:'1',group:'balance',amount:'50000.00'},{description:'Inverter',unit:'Each',qty:'2',group:'bess',amount:'500000.00'}];
 const before=JSON.stringify(lines),rows=quotationDisplayRows(lines);
 assert.deepEqual(rows.map(r=>[r.unit,r.qty,r.amount]),[['MTRS','15','1500.00'],['JOB','1','100000.00'],['JOB','1','50000.00'],['Each','2','500000.00']]);assert.equal(JSON.stringify(lines),before);
});

test('structure description uses saved quotation panel quantity without changing commercial values',()=>{
 const lines:QuoteLine[]=[{description:'Solar PV Modules',unit:'No.',qty:'15',group:'solar',amount:'1000.00'},{description:'Elevated Solar Mounting Structure for PV Array',unit:'LS',qty:'1',group:'structure',amount:'500.00'}];
 const before=JSON.stringify(lines),rows=quotationDisplayRows(lines);
 assert.equal(rows[1].description,'Elevated Solar Mounting Structure for PV Array for 15 panels');
 assert.equal(rows[1].qty,'1');assert.equal(rows[1].amount,'500.00');assert.equal(JSON.stringify(lines),before);
 assert.equal(quotationDisplayRows(rows)[1].description,rows[1].description);
});
