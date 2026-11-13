import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {issuedCustomerSignoffModels,issuedDispatchPrintModel} from '../server/inventory/material-document-model.js';
import {deliveryOrderPdf,parentDoCopies,warehouseDoCopies} from '../server/inventory/material-document-pdf.js';
import {noFixedItemsText,splitDeliveryOrder,variableGatePassTitle} from '../shared/delivery-order-split.js';

async function pages(bytes:Buffer){const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});try{const pdf=await task.promise,output:string[]=[];for(let n=1;n<=pdf.numPages;n++)output.push((await(await pdf.getPage(n)).getTextContent()).items.map((i:any)=>i.str??'').join(' '));return output;}finally{await task.destroy();}}

const site={siteId:'11111111-1111-4111-8111-111111111111',siteName:'Sample Site A',ipo:'IPO-SAMPLE-1',customer:'Sample Customer',installation:true};
const lines=[
 {key:'k1',itemId:'CH-PCS-15KW',description:'15kW hybrid inverter',unit:'Nos',out:'1',sites:[site.siteId]},
 {key:'k2',itemId:'CH-CBL-16MM-AC',description:'16mm2 AC cable',unit:'Meter',out:'40',sites:[site.siteId]},
 {key:'k3',itemId:'CH-LUGS-16',description:'16mm lugs',unit:'Nos',out:'12',sites:[site.siteId],documentPolicyVersion:2 as const},
];
function record(overrides:Record<string,unknown>={}){
 return {id:'22222222-2222-4222-8222-222222222222',number:'DO-SAMPLE-1',created_at:'2026-11-13T05:00:00Z',snapshot:{warehouse:'Karachi',parent:false,kind:'fixed' as const,sites:[site],lines,status:'issued',stockPosting:false,requiresSignedGate:true,transport:{issuedTo:'Driver A',vehicle:'ABC-1',driver:'Driver A'},...overrides}};
}

// Locks behaviour that must not change: the DO record and its model still carry
// every line (stock OUT and the VSO depend on them); a Parent DO is untouched.
test('the issued DO model still holds every dispatched line, and the VSO still lists the variable items',()=>{
 const model=issuedDispatchPrintModel(record());
 assert.deepEqual(model.rows.map(r=>r.itemId),['CH-PCS-15KW','CH-CBL-16MM-AC','CH-LUGS-16']);
 assert.equal(model.kind,'fixed-do');
 const vso=issuedCustomerSignoffModels(record());
 assert.equal(vso.length,1);
 assert.deepEqual(vso[0].rows.map(r=>[r.itemId,r.issued]),[['CH-CBL-16MM-AC','40'],['CH-LUGS-16','12']]);
 const parent=issuedDispatchPrintModel(record({parent:true,kind:'variable',lines:lines.slice(1)}));
 assert.equal(parent.kind,'variable-do');
 assert.deepEqual(parent.rows.map(r=>r.itemId),['CH-CBL-16MM-AC','CH-LUGS-16']);
});

test('a site DO lists fixed items only; its variable items move to a Variable Material Gate Pass under the same DO number',()=>{
 const [fixed,variable,...rest]=splitDeliveryOrder(issuedDispatchPrintModel(record()));
 assert.equal(rest.length,0);
 assert.deepEqual(fixed.rows.map(r=>r.itemId),['CH-PCS-15KW']);
 assert.equal(fixed.kind,'fixed-do');
 assert.equal(variable.title,variableGatePassTitle);
 assert.equal(variable.variableGatePass,true);
 assert.equal(variable.reference,'DO-SAMPLE-1');
 assert.deepEqual(variable.rows.map(r=>[r.itemId,r.issued]),[['CH-CBL-16MM-AC','40'],['CH-LUGS-16','12']]);
 // Splitting again changes nothing (the browser and server can both apply it).
 assert.deepEqual([fixed,variable].flatMap(splitDeliveryOrder),[fixed,variable]);
});

test('Additional DO with only cable keeps its DO pages, says there are no fixed items, and adds the gate pass',()=>{
 const parts=splitDeliveryOrder(issuedDispatchPrintModel(record({additional:true,lines:lines.slice(1,2)})));
 assert.equal(parts.length,2);
 assert.equal(parts[0].title,'Additional Delivery Order · Extra Material');
 assert.equal(parts[0].rows.length,0);
 assert.equal(parts[0].emptyRowsText,noFixedItemsText);
 assert.deepEqual(parts[1].rows.map(r=>r.itemId),['CH-CBL-16MM-AC']);
});

test('Parent DOs, delivery-only sales and VSOs are not split',()=>{
 const parent=issuedDispatchPrintModel(record({parent:true,kind:'variable',lines:lines.slice(1)}));
 assert.deepEqual(splitDeliveryOrder(parent),[parent]);
 const delivery=issuedDispatchPrintModel(record({sites:[{...site,installation:false}]}));
 assert.deepEqual(splitDeliveryOrder(delivery),[delivery]);
 assert.equal(delivery.rows.length,3,'A delivery-only sale can sell cable as a product; it stays on its DO.');
 const vso=issuedCustomerSignoffModels(record())[0];
 assert.deepEqual(splitDeliveryOrder(vso),[vso]);
 const fixedOnly=issuedDispatchPrintModel(record({lines:lines.slice(0,1)}));
 assert.deepEqual(splitDeliveryOrder(fixedOnly).map(m=>m.rows.length),[1]);
});

test('the downloaded DO PDF shows fixed items on the DO and variable items only on the gate pass pages',async()=>{
 const model=issuedDispatchPrintModel(record());
 const single=await pages(deliveryOrderPdf(model));
 assert.equal(single.length,2);
 assert.match(single[0],/Fixed Material Delivery Order/);assert.match(single[0],/15kW hybrid inverter/);assert.doesNotMatch(single[0],/16mm2 AC cable|16mm lugs/);assert.match(single[0],/Customer received by/);
 assert.match(single[1],/Variable Material Gate Pass/);assert.match(single[1],/DO-SAMPLE-1/);assert.match(single[1],/16mm2 AC cable/);assert.match(single[1],/16mm lugs/);assert.doesNotMatch(single[1],/15kW hybrid inverter|Customer received by/);assert.match(single[1],/Site team received by/);
 const copies=await pages(deliveryOrderPdf(model,warehouseDoCopies));
 assert.equal(copies.length,6,'Four DO copies, then the gate pass as Gate copy and Storekeeper copy.');
 assert.match(copies[4],/Variable Material Gate Pass · Gate copy|Gate copy/);assert.match(copies[5],/Storekeeper copy/);
 const parent=await pages(deliveryOrderPdf(issuedDispatchPrintModel(record({parent:true,kind:'variable',lines:lines.slice(1)})),parentDoCopies));
 assert.equal(parent.length,2);assert.ok(parent.every(p=>/16mm2 AC cable/.test(p)&&!/Variable Material Gate Pass/.test(p)));
});
