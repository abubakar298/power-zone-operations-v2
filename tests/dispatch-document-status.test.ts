import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dispatchDocumentRows,dispatchBoard} from '../server/inventory/dispatch-document-status.js';
const date='2026-11-01T08:00:00Z',later='2026-11-01T09:00:00Z';
const site={siteId:'ipo-one',registeredSiteId:'board-one',siteName:'First site',customer:'UBL',ipo:'CHP-163',orderNumber:'165/250',installation:true};
const fixed={key:'fixed',itemId:'CH-PCS-6',description:'Inverter with cables',out:'1',sites:['ipo-one']};
const cable={key:'cable',itemId:'CH-CBL-AC',description:'Cable',out:'20',sites:['ipo-one']};
const dispatch=(id='d1',lines:any[]=[fixed],parent=false)=>({id,number:'DO-'+id,draft_id:'draft',warehouse:'Lahore warehouse',created_at:date,snapshot:{parent,sites:[site],lines}});
const board=(snapshot:any={})=>({site_id:'board-one',snapshot:{installation:true,...snapshot}});
const file=(id:string,site_id='board-one',created_at=later)=>({id,site_id,created_at});
const ack={acknowledgement:{id:'ack'}};
const delivery={signedDo:{id:'do'},dispatchId:'d1'};
test('actual deliveries require the applicable signed documents, never gate copies, orphan files or IRR presence',()=>{
 const rows=dispatchDocumentRows([dispatch()], [board({deliveries:[delivery],qcJob:ack})],[],[file('do'),file('ack')],[]);
 assert.equal(rows[0].status,'ready');assert.deepEqual(rows[0].sites[0].documents.map(d=>d.label),['Signed DO']);
 assert.equal(dispatchDocumentRows([dispatch()],[board({qcJob:{irr:{id:'irr'}}})],[{document_id:'d1',source_site_id:null,copy_kind:'signed-gate',evidence_id:'gate'}],[file('irr'),file('do')],[])[0].status,'awaiting');
 assert.equal(dispatchDocumentRows([dispatch()],[board({deliveries:[delivery],qcJob:ack})],[],[file('do','another-site'),file('ack')],[])[0].status,'awaiting');
});
test('partial deliveries cannot reuse an ambiguous or explicitly different DO',()=>{
 const d=[dispatch(),dispatch('d2')],legacy=board({deliveries:[{signedDo:{id:'do'}}],qcJob:ack});
 assert.deepEqual(dispatchDocumentRows(d,[legacy],[],[file('do'),file('ack')],[]).map(r=>r.status),['awaiting','awaiting']);
 const exact=dispatchDocumentRows(d,[board({deliveries:[delivery],qcJob:ack})],[],[file('do'),file('ack')],[]);
 assert.match(exact[0].reviewNote??'',/Possible duplicate/);
 assert.deepEqual(exact.map(r=>r.status),['ready','awaiting']);
});
test('variable signoff is conditional on what was dispatched and old completion evidence does not clear new material',()=>{
 const d=dispatch('d1',[fixed,cable]);
 const b=board({deliveries:[delivery],qcJob:{...ack,variableSignoff:{id:'vso'}}});
 assert.equal(dispatchDocumentRows([d],[b],[],[file('do'),file('ack')],[])[0].status,'awaiting');
 assert.equal(dispatchDocumentRows([d],[b],[],[file('do'),file('ack'),file('vso')],[])[0].status,'ready');
 assert.equal(dispatchDocumentRows([d],[b],[],[file('do'),file('ack'),file('vso','board-one','2026-10-31T10:00:00Z')],[])[0].status,'awaiting');
 const u={draft_id:'draft',site_id:'ipo-one',created_at:later,evidence_warehouse:'Lahore warehouse',snapshot:{state:'signed',customerEvidenceId:'usage',lines:[{lineKey:'cable',used:'15'}]}};
 assert.equal(dispatchDocumentRows([d],[board({deliveries:[delivery],qcJob:ack})],[],[file('do'),file('ack')],[u])[0].status,'ready');
 assert.equal(dispatchDocumentRows([d],[board({deliveries:[delivery],qcJob:ack})],[],[file('do'),file('ack')],[{...u,evidence_warehouse:'Karachi warehouse'}])[0].status,'awaiting');
});
test('Parent DO uses per-site variable signoffs, no customer signature on internal pool; closed pools leave queue',()=>{
 const d=dispatch('parent',[cable],true),b=board({qcJob:{...ack,variableSignoff:{id:'vso'}}});
 const row=dispatchDocumentRows([d],[b],[],[file('ack'),file('vso')],[])[0];assert.equal(row.status,'ready');
 assert.deepEqual(row.sites[0].documents.map(v=>v.label),['Variable Items Sign Off']);
 assert.match(row.reconciliationStatus,/returns require reconciliation/);
 assert.equal(dispatchDocumentRows([d],[b],[],[file('ack'),file('vso')],[],new Set(['draft'])).length,0);
});
test('same PO, IPO text, customer or site name never substitutes for exact native/registered identity',()=>{
 assert.equal(dispatchBoard(site,[{site_id:'wrong',snapshot:{...site}}]),undefined);
 assert.equal(dispatchBoard({...site,registeredSiteId:undefined},[{site_id:'right',snapshot:{origin:{ipoId:'ipo-one'}}}])?.site_id,'right');
 assert.equal(dispatchBoard({...site,registeredSiteId:undefined},[{site_id:'a',snapshot:{origin:{ipoId:'ipo-one'}}},{site_id:'b',snapshot:{origin:{ipoId:'ipo-one'}}}]),undefined);
 const d=dispatch();d.snapshot.sites=[{...site,installation:false}];assert.equal(dispatchDocumentRows([d],[board({installation:false,deliveries:[delivery]})],[],[file('do')],[])[0].status,'ready');
});
test('owner-confirmed retrospective DOs bypass unavailable DO copies but still require VSO',()=>{
 const d={...dispatch(),retrospective:true};
 const before=dispatchDocumentRows([d],[board()],[],[],[])[0];assert.equal(before.status,'awaiting');assert.deepEqual(before.sites[0].documents.map(v=>v.label),['Variable Items Sign Off']);
 const b=board({qcJob:{...ack,variableSignoff:{id:'vso'}}});
 const older=[file('ack','board-one','2026-10-30T08:00:00Z'),file('vso','board-one','2026-10-30T08:00:00Z')];
 const ready=dispatchDocumentRows([d],[b],[],older,[])[0];assert.equal(ready.status,'ready');assert.equal(ready.retrospective,true);assert.match(ready.reconciliationStatus,/gate copy waived/);
 assert.equal(dispatchDocumentRows([dispatch()],[b],[],older,[])[0].status,'awaiting','Normal DOs retain gate/delivery evidence requirements.');
});

import {groupDispatchDocumentSites} from '../shared/dispatch-document-status.js';
test('site buckets split mixed Parent DO readiness and retain every partial dispatch without merging shared IPOs',()=>{
 const base=dispatchDocumentRows([{...dispatch(),retrospective:true}],[board({qcJob:{...ack,variableSignoff:{id:'vso'}}})],[],[file('ack'),file('vso')],[])[0];
 const readySite={...base.sites[0],usageReady:true};
 const second={...readySite,siteId:'ipo-two',registeredSiteId:'board-two',name:readySite.name,ipo:readySite.ipo,documents:[{label:'Variable Items Sign Off' as const}]};
 const parent={...base,id:'pool',parent:true,status:'awaiting' as const,sites:[readySite,second]};
 let sites=groupDispatchDocumentSites([parent]);assert.equal(sites.length,2);assert.equal(sites.find(s=>s.id==='board-one')?.status,'ready');assert.equal(sites.find(s=>s.id==='board-two')?.status,'awaiting');
 const partial={...base,id:'later',createdAt:'2026-11-02T10:00:00Z',sites:[{...readySite,documents:[{label:'Signed DO' as const}]}]};
 sites=groupDispatchDocumentSites([parent,partial,partial]);const first=sites.find(s=>s.id==='board-one')!;assert.equal(first.status,'awaiting');assert.equal(first.dispatches.length,2);assert.deepEqual(first.dispatches.map(d=>d.dispatch.id),['later','pool']);assert.equal(sites.length,2);
});

test('Inventory document requirements stay DO/VSO only while QC usage is a separate readiness gate',()=>{
 const fixedOnly=dispatchDocumentRows([dispatch()],[board({deliveries:[delivery]})],[],[file('do')],[])[0];assert.equal(fixedOnly.status,'ready');assert.deepEqual(fixedOnly.sites[0].documents.map(d=>d.label),['Signed DO']);
 const pooled=dispatchDocumentRows([dispatch('pool',[cable],true)],[board({qcJob:{variableSignoff:{id:'vso'}}})],[],[file('vso')],[])[0];assert.equal(pooled.status,'ready');assert.deepEqual(pooled.sites[0].documents.map(d=>d.label),['Variable Items Sign Off']);
 const variable=dispatchDocumentRows([dispatch('d1',[fixed,cable])],[board({deliveries:[delivery],qcJob:{variableSignoff:{id:'vso'}}})],[],[file('do'),file('vso')],[])[0];assert.equal(variable.status,'ready');assert.equal(variable.sites[0].documents.length,2);
 const legacy={...variable,sites:[{...variable.sites[0],usageReady:true,documents:[...variable.sites[0].documents,{label:'Acknowledgment' as const}]}]};const grouped=groupDispatchDocumentSites([legacy]);assert.equal(grouped[0].status,'ready');assert.equal(grouped[0].dispatches[0].site.documents.some(d=>d.label==='Acknowledgment'),false);
});

test('new owner-confirmed retrospective gate exception does not waive a customer signed DO',()=>{
 const d={...dispatch(),retrospective:true,customer_do_waived:false};
 const pending=dispatchDocumentRows([d],[board({qcJob:{variableSignoff:{id:'vso'}}})],[],[file('vso')],[])[0];assert.equal(pending.status,'awaiting');assert.deepEqual(pending.sites[0].documents.map(d=>d.label),['Signed DO']);
 const ready=dispatchDocumentRows([d],[board({deliveries:[delivery]})],[],[file('do')],[])[0];assert.equal(ready.status,'ready');
});

test('a no-variable declaration applies only to its existing dispatch and never credits returns',()=>{
 const d=dispatch('d1',[cable],true);
 const current=board({qcJob:{noVariableItemsUsed:true,recordedAt:later}});
 assert.equal(dispatchDocumentRows([d],[current],[],[],[])[0].status,'ready');
 const old=board({qcJob:{noVariableItemsUsed:true,recordedAt:'2026-10-30T08:00:00Z'}});
 assert.equal(dispatchDocumentRows([d],[old],[],[],[])[0].status,'awaiting');
 assert.equal(dispatchDocumentRows([d],[board({qcJob:{noVariableItemsUsed:true}})],[],[],[])[0].status,'awaiting');
 assert.match(dispatchDocumentRows([d],[current],[],[],[])[0].reconciliationStatus,/returns require reconciliation/);
});


test('Inventory readiness requires fresh QC-saved usage, not just signed files; delivery-only receipts need no return queue',()=>{
 const d=dispatch(),b=board({deliveries:[delivery]});
 let rows=dispatchDocumentRows([d],[b],[],[file('do')],[]);
 assert.equal(rows[0].sites[0].usageReady,false);assert.equal(groupDispatchDocumentSites(rows)[0].status,'awaiting');
 const u={draft_id:'draft',site_id:'ipo-one',created_at:later,snapshot:{workflowVersion:2,state:'signed',lines:[{lineKey:'fixed',used:'1'}]}};
 rows=dispatchDocumentRows([d],[b],[],[file('do')],[u]);assert.equal(groupDispatchDocumentSites(rows)[0].status,'ready');
 assert.equal(dispatchDocumentRows([d],[b],[],[file('do')],[{...u,created_at:'2026-10-31T08:00:00Z'}])[0].sites[0].usageReady,false);
 assert.equal(dispatchDocumentRows([d],[b],[],[file('do')],[{...u,snapshot:{...u.snapshot,workflowVersion:1}}])[0].sites[0].usageReady,false);
 const delivered=dispatchDocumentRows([{...d,snapshot:{...d.snapshot,sites:[{...site,installation:false}]}}],[b],[],[file('do')],[]);assert.equal(groupDispatchDocumentSites(delivered).length,0);
});
