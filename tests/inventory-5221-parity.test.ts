/// <reference path="../web/inventory-approved/legacy-helpers.d.ts" />
import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SiteIssueDocument,SiteIssuePrintDocuments,type IssueProject,type IssueRecord} from '../web/inventory-approved/SiteIssueDocument.js';
import {issuedCustomerSignoffModels,parentDraftPrintModel} from '../server/inventory/material-document-model.js';

const project:IssueProject={id:'site',ipo:'IPO-1',site:'Test site',customer:'Test customer',deliveryAddress:'',installation:true,warehouse:'Lahore',lines:[]};
const record:IssueRecord={number:'PDO-1',project:'site',warehouse:'Lahore',date:'2026-10-29',expected:{},quantities:{},extras:[{id:'CH-Flex Pipe 1',description:'Flexible pipe',quantity:'10',unit:'m'}],recorded:false};
test('parent warehouse DO retains gate and storekeeper copies while individual DO retains all four',()=>{
 const parent=renderToStaticMarkup(React.createElement(SiteIssuePrintDocuments,{mode:'do',project:{...project,parentDispatch:true},record}));
 assert.match(parent,/Gate copy/);assert.match(parent,/Storekeeper copy/);
 assert.doesNotMatch(parent,/Customer receipt and signature|Customer handover confirmation/);
 const individual=renderToStaticMarkup(React.createElement(SiteIssuePrintDocuments,{mode:'do',project,record}));
 assert.match(individual,/Customer receipt and signature/);assert.match(individual,/Customer handover confirmation/);
});
test('blank cable and mixed rows remain in their own modules with three explicit add actions',()=>{
 const html=renderToStaticMarkup(React.createElement(SiteIssueDocument,{project:{...project,lines:[{id:'UNMAPPED:cable',description:'Cable test row',quantity:'',keepEmpty:true,entryType:'cable'},{id:'UNMAPPED:mixed',description:'Mixed test row',quantity:'',keepEmpty:true,entryType:'variable'}]},record:{...record,extras:[]},copyMode:'master',edit:{values:{},used:{},returned:{},remarks:{},extras:[],panelValues:{},onChange:()=>{},onField:()=>{},onPanel:()=>{},onExtra:()=>{},onChangeId:()=>{},onRemoveLine:()=>{},onAddFixedItem:()=>'',onAddCableItem:()=>'',onAddVariableItem:()=>''}}));
 const cable=html.match(/aria-label="Variable cable issuance"[\s\S]*?<\/section>/)?.[0]??'';
 const mixed=html.match(/aria-label="Variable Mixed Items Issuance"[\s\S]*?<\/section>/)?.[0]??'';
 assert.match(cable,/Cable test row/);assert.doesNotMatch(cable,/Mixed test row/);
 assert.match(mixed,/Mixed test row/);assert.doesNotMatch(mixed,/Cable test row/);
 assert.equal((html.match(/＋ Add item/g)??[]).length,3);
 assert.doesNotMatch(html,/type="checkbox"/);
});
test('parent printable preparation excludes empty and zero quantities before site signoff projection',()=>{
 const draft:any={id:'draft',version:1,snapshot:{warehouse:'Lahore',parent:true,kind:'variable',sites:[{siteId:'site',siteName:'Test site',installation:true,ipo:'IPO-1'}],lines:[{key:'a',itemId:'CH-Flex Pipe 1',description:'Flexible pipe',unit:'m',out:'10',sites:['site']},{key:'b',itemId:'CH-Pvc Pipe 1.5 Inch',description:'PVC pipe',unit:'m',out:'0',sites:['site']},{key:'c',itemId:'CH-Duct Slot 60x60',description:'Duct',unit:'m',out:'',sites:['site']}]}};
 const model=parentDraftPrintModel(draft,'customer-signoff','site');
 assert.deepEqual(model.rows.map(r=>r.itemId),['CH-Flex Pipe 1']);
 assert.equal(model.omitIssued,true);
 assert.equal(model.stockPosting,false);
});

test('batch sign-offs keep site allocations and omit zero rows before combining the print job',()=>{
 const record:any={id:'parent',number:'PDO-2',created_at:'2026-10-29',snapshot:{status:'issued',stockPosting:false,requiresSignedGate:true,kind:'variable',parent:true,warehouse:'Lahore',sites:[{siteId:'a',siteName:'Site A',ipo:'IPO-A',installation:true},{siteId:'b',siteName:'Site B',ipo:'IPO-B',installation:true}],lines:[{itemId:'CH-Flex Pipe 1',description:'Flexible pipe',unit:'m',out:'4',sites:['a']},{itemId:'CH-Duct Slot 60x60',description:'Zero duct',unit:'m',out:'0',sites:['a','b']},{itemId:'CH-Pvc Pipe 1.5 Inch',description:'PVC pipe',unit:'m',out:'6',sites:['b']}]}};
 const models=issuedCustomerSignoffModels(record);assert.equal(models.length,2);
 assert.deepEqual(models.map(m=>[m.sourceSiteId,m.sites[0].name,m.rows.map(r=>r.itemId)]),[['a','Site A',['CH-Flex Pipe 1']],['b','Site B',['CH-Pvc Pipe 1.5 Inch']]]);
 assert.ok(models.every(m=>m.omitIssued&&m.rows.every(r=>r.issued===null)));
});
