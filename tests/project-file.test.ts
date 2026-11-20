import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {projectFile,projectFileStages} from '../server/coordinator/project-file.js';
import {ProjectFileView} from '../web/components/ProjectFileView.js';

const documents=[
 {id:'d1',resource:'draft',type:'Survey draft',number:'',version:1,stage:'Saved',created_at:'2026-10-01T05:00:00Z',pdf_url:null},
 {id:'b1',resource:'boq',type:'BOQ',number:'CPZ-PBQ-1',version:0,stage:'Saved',created_at:'2026-10-02T05:00:00Z',pdf_url:'/api/boqs/b1/costing.pdf'},
 {id:'q1',resource:'quotation',type:'Quotation',number:'CPZ-QT-1-R1',version:1,stage:'Approved',version_status:'Current',created_at:'2026-10-03T05:00:00Z',pdf_url:'/api/commercial/quotations/q1/quotation.pdf'},
 {id:'i1',resource:'ipo',type:'IPO / PT',number:'CHP-163',version:1,stage:'Issued',created_at:'2026-10-28T05:00:00Z',pdf_url:'/api/orders/i1/ipo.pdf'},
];
const attachments=[{id:'a1',filename:'PO.pdf',type:'Customer PO / approval evidence',created_at:'2026-10-27T05:00:00Z',url:'/api/orders/documents/a1'},{id:'a2',filename:'survey.jpg',type:'Survey / supporting attachment',created_at:'2026-10-01T06:00:00Z',url:'/api/boqs/uploads/a2'}];
const trail={
 deliveryOrders:[{id:'do1',number:'DO-5412',warehouse:'Karachi warehouse',created_at:'2026-11-01T05:00:00Z',signed:true},{id:'do2',number:'DO-5413',warehouse:'Karachi warehouse',created_at:'2026-11-02T05:00:00Z',signed:false}],
 sites:[{site_id:'live-ipo:i1',stage:'completed',installation:true,created_at:'2026-11-10T05:00:00Z',documents:[{id:'vso',label:'VSO',location:'Submitted to Accounts',date:'2026-11-12'}]}],
 invoices:[{id:'inv1',pt_reference:'27-20178',milestone:'completion',entry_date:'2026-11-15'}],
};
const stage=(file:any[],name:string)=>file.find(s=>s.stage===name)!.items;

test('the project file lists every record of the site under the standard stages, in work order',()=>{
 const file=projectFile(documents,attachments,trail,true);
 assert.deepEqual(file.map(s=>s.stage),[...projectFileStages]);
 assert.deepEqual(stage(file,'Site survey').map((i:any)=>i.title),['Survey draft','survey.jpg']);
 assert.deepEqual(stage(file,'Purchase order').map((i:any)=>i.title),['PO.pdf']);
 assert.deepEqual(stage(file,'IPO').map((i:any)=>i.title),['CHP-163']);
 assert.deepEqual(stage(file,'Material issue / DO').map((i:any)=>[i.title,i.detail]),[['DO-5412','Karachi warehouse · signed copy received, stock out posted'],['DO-5413','Karachi warehouse · awaiting signed copy']]);
 assert.deepEqual(stage(file,'Installation & QC').map((i:any)=>i.title),['Completed','VSO']);
 assert.deepEqual(stage(file,'Invoice').map((i:any)=>i.title),['27-20178']);
 assert.equal(stage(file,'IPO')[0].url,'/api/orders/i1/ipo.pdf','documents link to their one saved copy');
});

test('Coordinators see the work trail but not invoices or DO document links',()=>{
 const file=projectFile(documents,attachments,trail,false);
 assert.equal(stage(file,'Invoice').length,0);
 assert.ok(stage(file,'Material issue / DO').every((i:any)=>i.url===null));
 assert.equal(stage(file,'Material issue / DO').length,2);
});

test('a site that is not yet delivered shows under Delivery; empty stages say nothing is recorded yet',()=>{
 const file=projectFile(documents,[],{deliveryOrders:[],sites:[{site_id:'s',stage:'awaiting',installation:true,created_at:'2026-11-01T00:00:00Z',documents:[]}],invoices:[]},true);
 assert.deepEqual(stage(file,'Delivery').map((i:any)=>i.title),['Awaiting delivery']);
 const html=renderToStaticMarkup(React.createElement(ProjectFileView,{stages:file,onPreview:()=>true}));
 assert.match(html,/Material issue \/ DO <span class="pz-caption">\(0\)<\/span>/);
 assert.match(html,/Nothing recorded yet\./);
 assert.match(html,/CHP-163/);assert.match(html,/<th scope="col">SR#<\/th>/,'every list has an SR# column');
});
