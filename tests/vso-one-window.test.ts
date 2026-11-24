import {test} from 'node:test';
import assert from 'node:assert/strict';
import {paginateMaterialRows as paginateUntyped} from '../web/inventory-approved/print-pagination.mjs';
import {deliveryOrderWithVso,issuedDispatchPrintModel} from '../server/inventory/material-document-model.js';
import {vsoBlankRows,vsoMinimumBlankLines} from '../shared/vso-blank-lines.js';
import {withVso} from '../web/inventory-approved/do-window.js';

const site={siteId:'11111111-1111-4111-8111-111111111111',siteName:'Sample Site A',ipo:'IPO-SAMPLE-1',customer:'Sample Customer',installation:true};
const other={...site,siteId:'33333333-3333-4333-8333-333333333333',siteName:'Sample Site B',ipo:'IPO-SAMPLE-2'};
const inverter={key:'k1',itemId:'CH-PCS-15KW',description:'15kW hybrid inverter',unit:'Nos',out:'1',sites:[site.siteId]};
const cable={key:'k2',itemId:'CH-CBL-16MM-AC',description:'16mm2 AC cable',unit:'Meter',out:'40',sites:[site.siteId]};
function record(overrides:Record<string,unknown>={}){
 return {id:'22222222-2222-4222-8222-222222222222',number:'DO-SAMPLE-1',created_at:'2026-11-13T05:00:00Z',snapshot:{warehouse:'Karachi',parent:false,kind:'fixed' as const,sites:[site],lines:[inverter,cable],status:'issued',stockPosting:false,requiresSignedGate:true,transport:{issuedTo:'Driver A',vehicle:'ABC-1',driver:'Driver A'},...overrides}};
}
const paginateMaterialRows=(...args:Parameters<typeof paginateUntyped>)=>paginateUntyped(...args) as unknown[][];
const rows=(n:number)=>Array.from({length:n},(_,i)=>({id:'CH-ITEM-'+i,name:'Item '+i}));

// Locks today's behaviour: DO pages add up to the requested blank rows only while the page has room.
test('DO pages keep their blank rows only while the last page has room',()=>{
 assert.deepEqual(paginateMaterialRows(rows(2),'do',{blankRows:3}).map(p=>p.length),[5]);
 const full=paginateMaterialRows(rows(18),'do',{blankRows:3});
 assert.deepEqual(full.map(p=>p.length),[18]);
 assert.equal(full[0].filter(r=>r===undefined).length,0);
});

test('a VSO always keeps at least two blank lines, moving its last item to a new page when the page is full',()=>{
 assert.equal(vsoMinimumBlankLines,2);
 assert.equal(vsoBlankRows(undefined),2);assert.equal(vsoBlankRows(0),2);assert.equal(vsoBlankRows(3),3);assert.equal(vsoBlankRows(5),5);
 for(const count of [0,1,15,16,17,18,19,35,36,40]){
  const pages=paginateMaterialRows(rows(count),'do',{blankRows:5,minBlankRows:2});
  const last=pages.at(-1)!,listed=pages.flat().filter(Boolean);
  assert.equal(listed.length,count,'no item is dropped ('+count+')');
  assert.ok(last.filter(r=>r===undefined).length>=2,'two blank lines at the end ('+count+')');
  assert.ok(pages.every(p=>p.length<=18),'no page is over-filled ('+count+')');
 }
 // Short lists keep the blank rows they had.
 assert.equal(paginateMaterialRows(rows(2),'do',{blankRows:5,minBlankRows:2})[0].filter(r=>r===undefined).length,5);
});

test('the DO window bundles the DO with one VSO per site, also for a DO with only fixed items',()=>{
 const variable=record(),model=issuedDispatchPrintModel(variable);
 const bundle=deliveryOrderWithVso(variable,model);
 assert.equal(bundle.documents[0],model);
 assert.deepEqual(bundle.documents.map(d=>d.kind),['fixed-do','customer-signoff']);
 assert.deepEqual(bundle.documents[1].rows.map(r=>r.itemId),['CH-CBL-16MM-AC']);
 const fixedOnly=record({lines:[inverter]}),fixed=deliveryOrderWithVso(fixedOnly,issuedDispatchPrintModel(fixedOnly));
 assert.deepEqual(fixed.documents.map(d=>d.kind),['fixed-do','customer-signoff']);
 assert.equal(fixed.documents[1].rows.length,0);assert.equal(fixed.documents[1].blankRows,5);
 const parent=record({parent:true,kind:'variable',sites:[site,other],lines:[{...cable,sites:[site.siteId,other.siteId]}]});
 assert.deepEqual(deliveryOrderWithVso(parent,issuedDispatchPrintModel(parent)).documents.map(d=>d.kind),['variable-do','customer-signoff','customer-signoff']);
});

test('the DO window address asks the server for the VSO too',()=>{
 assert.equal(withVso('/api/material-dispatches/issued/abc/document.pdf'),'/api/material-dispatches/issued/abc/document.pdf?with=vso');
 assert.equal(withVso('/x/document.pdf?site=1'),'/x/document.pdf?site=1&with=vso');
});
