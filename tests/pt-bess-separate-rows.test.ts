import {test} from 'node:test';
import assert from 'node:assert/strict';
import {peachtreeDivision} from '../server/orders/peachtree-v5.js';
import {ptDetail,ptDisplayRows} from '../server/orders/pt-detail.js';
import {DISCOUNT_POLICY} from '../server/commercial/discount-strategy.js';

// Accounts rule (Nov 2026): whatever the quotation type, the Peachtree division lists the inverter, the
// batteries and the BMS in separate rows with their own amounts, never one combined "BESS" row.
const pricing:any={input:{saleType:'Cash Deal',cashGstTreatment:'Included in selling price',presentation:'Basic Breakup',taxMode:'Tax Included'}};
const boqLines=[
 {key:'CH-PCS-HYB-3P-020',phase:'BESS',qty:'1',unit:'No.',specification:'Inverter Hybrid PCS-3P 20-KW',description:'CH-PCS-HYB-3P-020'},
 {key:'CH-BAT-HV-05 KW',phase:'BESS',qty:'2',unit:'No.',specification:'Inverter Battery HV WO BMS 5 kWh',description:'CH-BAT-HV-05 KW'},
 {key:'CH-BMS-HV',phase:'BESS',qty:'1',unit:'No.',specification:'BMS-High Voltage',description:'CH-BMS-HV'},
 {key:'Earthing Bore',phase:'EPC',epc:'Earthing Cost',qty:'1',unit:'No.',description:'Earthing Bore'},
 {key:'Labour',phase:'EPC',qty:'1',unit:'JOB',description:'Labour'},
];
const bessOnly:any={survey:{family:'bess-only'},lines:boqLines};
const names=(d:any)=>d.phases.map((p:any)=>[p.name,p.amount]);

test('item-discount quotations (current pricing): BESS-only PT has separate inverter, batteries and BMS rows that add up exactly',()=>{
 const line=(key:string,group:string,phase:string,total:string)=>({key,description:key,group,phase,beforeTax:total,tax:'0.00',total,approvedDiscount:'0.00',managementSpecialDiscount:'0.00'});
 const allocation:any={policy:DISCOUNT_POLICY,subtotal:'1596000.00',tax:'0.00',total:'1596000.00',lines:[
  line('CH-PCS-HYB-3P-020','bess','Inverter','400000.00'),line('CH-BAT-HV-05 KW','bess','Batteries','600000.00'),line('CH-BMS-HV','bess','BMS','185673.56'),
  line('Earthing Bore','earthing','EPC','32450.00'),line('Labour','balance','EPC','377876.44')]};
 const d=peachtreeDivision(allocation,bessOnly,pricing);
 assert.deepEqual(names(d),[['Inverter','400000.00'],['Batteries','600000.00'],['BMS','185673.56'],['EPC','410326.44']]);
 assert.equal(d.phaseTotal,'1596000.00');
 // Another BESS item that is not an inverter, battery or BMS keeps a "BESS" row of its own.
 const withRack:any={...allocation,total:'1606000.00',lines:[...allocation.lines,line('BESS Rack','bess','BESS','10000.00')]};
 assert.deepEqual(names(peachtreeDivision(withRack,{...bessOnly,lines:[...boqLines,{key:'BESS Rack',phase:'BESS',qty:'1',unit:'No.'}]},pricing)).map((r:any)=>r[0]),['Inverter','Batteries','BMS','BESS','EPC']);
});

test('older quotations (legacy pricing): BESS-only lines named "<brand> <specification>" land on their own rows',()=>{
 const line=(description:string,group:string,total:string)=>({description,group,qty:'1',unit:'No.',beforeTax:total,taxRate:'0',tax:'0.00',total});
 const allocation:any={policy:'proportional',subtotal:'1596000.00',tax:'0.00',total:'1596000.00',lines:[
  line('Chint Power Inverter Hybrid PCS-3P 20-KW','bess','400000.00'),line('Chint Power Inverter Battery HV WO BMS 5 kWh','bess','600000.00'),line('Chint Power BMS-High Voltage','bess','185673.56'),
  line('Earthing Bore','earthing','32450.00'),line('Installation and balance of system','balance','377876.44')]};
 const d=peachtreeDivision(allocation,bessOnly,pricing);
 assert.deepEqual(names(d),[['Inverter','400000.00'],['Batteries','600000.00'],['BMS','185673.56'],['EPC','410326.44']]);
 // A line that matches no BOQ item stays in a "BESS" row, so the total always reconciles.
 const unknown:any={...allocation,lines:allocation.lines.map((l:any,i:number)=>i===0?{...l,description:'Unrecognised BESS package'}:l)};
 assert.deepEqual(names(peachtreeDivision(unknown,bessOnly,pricing)),[['Inverter','0.00'],['Batteries','600000.00'],['BMS','185673.56'],['BESS','400000.00'],['EPC','410326.44']]);
});

test('direct product sale (legacy pricing): CHINT CH-PCS- and CH-BAT- items go to Inverter and Batteries, not EPC',()=>{
 const direct:any={survey:{family:'direct-product'},lines:boqLines.slice(0,3)};
 const line=(description:string,total:string)=>({description,group:'other',qty:'1',unit:'No.',beforeTax:total,taxRate:'0',tax:'0.00',total});
 const allocation:any={policy:'proportional',subtotal:'1185673.56',tax:'0.00',total:'1185673.56',lines:[line('CH-PCS-HYB-3P-020','400000.00'),line('CH-BAT-HV-05 KW','600000.00'),line('CH-BMS-HV','185673.56')]};
 const d=peachtreeDivision(allocation,direct,pricing);
 assert.deepEqual(names(d).filter((r:any)=>r[1]!=='0.00'),[['Inverter','400000.00'],['Batteries','600000.00'],['BMS','185673.56']]);
});

test('PT page rows: each BESS part shows its own item ID and quantity; an older combined BESS split is unchanged',()=>{
 const snapshot=(phases:any[])=>({allocation:{policy:'proportional'},peachtree:{taxMode:'Tax Included',phases}});
 const rows=ptDisplayRows(ptDetail(snapshot([{name:'Inverter',amount:'400000.00'},{name:'Batteries',amount:'600000.00'},{name:'BMS',amount:'185673.56'},{name:'EPC',amount:'410326.44'}]),bessOnly));
 assert.deepEqual(rows.slice(0,3).map((r:any)=>[r.name,r.itemId,r.description,r.amount]),[
  ['Inverter','CH-PCS-HYB-3P-020','1 No. x Inverter Hybrid PCS-3P 20-KW','400000.00'],
  ['Batteries','CH-BAT-HV-05 KW','2 No. x Inverter Battery HV WO BMS 5 kWh','600000.00'],
  ['BMS','CH-BMS-HV','1 No. x BMS-High Voltage','185673.56']]);
 const old=ptDetail(snapshot([{name:'BESS',amount:'1185673.56'},{name:'EPC',amount:'410326.44'}]),bessOnly);
 assert.equal(old.phases[0].itemId,'CH-PCS-HYB-3P-020\nCH-BAT-HV-05 KW\nCH-BMS-HV','a saved combined row still lists all three items');
});
