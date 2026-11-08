import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectMaterialCostingQueue,routeMaterialCosting} from '../server/accounts/material-costing.js';
import {historicalIssuedMaterials,additionalParentCables} from '../server/inventory/historical-qc-usage.js';
test('documents and material statements form one task, completed PT and Management jobs leave the queue',()=>{
 const report={id:'r',job_key:'ubl:68',version:2,stage:'Sent to Accounts',site_name:'Jhudo',job_id:'CHP-294',customer_code:'UBL',created_at:'2026-11-01'};
 const doc={id:'d',jobKey:'ubl:68',siteId:'registered-UBL:SOLAR:294',siteName:'Jhudo',ipo:'CHP-294',customer:'UBL',receivedAt:'2026-11-01'};
 const rows=projectMaterialCostingQueue([doc,{...doc,id:'vso'}],[report],[],[]);
 assert.equal(projectMaterialCostingQueue([doc],[{...report,customer_code:undefined}],[],[])[0].customer,'UBL','Exact QC document customer fills a missing legacy report label');
 assert.equal(rows.length,1);assert.equal(rows[0].documents.length,2);assert.equal(rows[0].status,'Ready for PT entry');
 assert.deepEqual(projectMaterialCostingQueue([doc],[report],[],[{source_id:'r',source_version:2}]),[]);
 assert.deepEqual(projectMaterialCostingQueue([doc],[report],[{job_key:'ubl:68',stage:'Awaiting Management'}],[]),[]);
 assert.deepEqual(projectMaterialCostingQueue([doc],[report],[{job_key:'ubl:68',stage:'Closed'}],[]),[]);
 assert.equal(projectMaterialCostingQueue([doc],[report],[],[{source_id:'r',source_version:1}]).length,1,'New versions must not inherit a prior PT receipt');
 assert.equal(projectMaterialCostingQueue([doc],[],[],[])[0].status,'Awaiting QC usage');
});
test('owner-authorized additional usage includes only extra Parent cables with their recorded units',()=>{
 const cables=additionalParentCables('CHP-294');
 assert.ok(cables.some(c=>c.description.startsWith('CH-CBL-CNT-1.5MM/2C')&&c.used==='40'&&c.unit==='m'));
 assert.equal(cables.some(c=>c.description.startsWith('CH-CBL-DC-6MM')),false,'DC already belongs in the screenshot/BOQ rows');
 assert.ok(cables.every(c=>c.description.startsWith('CH-CBL-')));
});
test('shared IPO text never merges different site identities',()=>{
 const d={ipo:'CHP-163',customer:'UBL',receivedAt:'2026-11-01',documents:[]};
 assert.equal(projectMaterialCostingQueue([{...d,siteId:'site-a'},{...d,siteId:'site-b'}],[],[],[]).length,2);
});
test('historical linkage exposes issued quantities without seeding old usage, returns or local purchases',()=>{
 const lines=historicalIssuedMaterials('CHP-294');assert.ok(lines.length>0);
 assert.ok(lines.some(l=>l.itemId==='CH-CBL-AC-25MM/4C-PK'&&l.issued==='30'));
 for(const line of lines){assert.equal('used' in line,false);assert.equal('returned' in line,false);assert.equal('effectiveReturn' in line,false);}
 assert.equal(lines.some(l=>l.description==='Screw washer'),false,'Local purchase lines stay outside warehouse references');
 assert.deepEqual(historicalIssuedMaterials('CHP-345'),[],'Missing historical issues must not become invented BOQ issues');
});

test('routing retains existing PT, waits for QC, and never offers a second PT entry',()=>{
 const base={siteId:'board',siteName:'Existing site',ipo:'CHP-5',customer:'UBL',ready:false,holds:['Parent DO variable usage pending'],signature:'sig',usage:[],localPurchases:[],completedDate:'',receivedAt:'2026-11-08',deliveryOnly:false,sources:{}};
 const handoffs=[
  {...base,jobKey:'ipo:one',aliases:['site:board']},
  {...base,jobKey:'ipo:two',aliases:[],ready:true,holds:[]},
  {...base,jobKey:'ipo:three',aliases:[],ready:true,holds:[]},
 ];
 const pt=[{job_key:'site:board'},{job_key:'ipo:two'},{job_key:'site:missing',snapshot:{siteName:'Unlinked site'}}];
 const ipos=[{id:'four',number:'CHP-6',snapshot:{siteName:'IPO recorded in PT'},created_at:'2026-11-07'}];
 const rows=routeMaterialCosting([],handoffs,[],pt,ipos);
 assert.equal(rows.find(r=>r.key==='ipo:one')?.status,'Parent DO variable usage pending');
 assert.equal(rows.find(r=>r.key==='ipo:one')?.ptRecorded,true);
 assert.equal(rows.find(r=>r.key==='ipo:one')?.canRecord,false);
 assert.ok(!rows.some(r=>r.key==='ipo:two'),'Ready with material PT belongs in closure');
 assert.ok(!rows.some(r=>r.key==='ipo:three'),'IPO still unrecorded belongs in IPOs Received');
 assert.equal(rows.find(r=>r.key==='ipo:four')?.status,'Awaiting QC delivery or material usage');
 assert.equal(rows.find(r=>r.key==='site:missing')?.status,'Approved site / material linkage needs review');
 assert.ok(!routeMaterialCosting([],handoffs,[{job_key:'ipo:one',stage:'Closed'}],pt,ipos).some(r=>r.key==='ipo:one'));
});
