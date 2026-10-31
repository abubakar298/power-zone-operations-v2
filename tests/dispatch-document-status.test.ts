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
 assert.equal(rows[0].status,'ready');assert.deepEqual(rows[0].sites[0].documents.map(d=>d.label),['Signed DO','Acknowledgment']);
 assert.equal(dispatchDocumentRows([dispatch()],[board({qcJob:{irr:{id:'irr'}}})],[{document_id:'d1',source_site_id:null,copy_kind:'signed-gate',evidence_id:'gate'}],[file('irr'),file('do')],[])[0].status,'awaiting');
 assert.equal(dispatchDocumentRows([dispatch()],[board({deliveries:[delivery],qcJob:ack})],[],[file('do','another-site'),file('ack')],[])[0].status,'awaiting');
});
test('partial deliveries cannot reuse an ambiguous or explicitly different DO',()=>{
 const d=[dispatch(),dispatch('d2')],legacy=board({deliveries:[{signedDo:{id:'do'}}],qcJob:ack});
 assert.deepEqual(dispatchDocumentRows(d,[legacy],[],[file('do'),file('ack')],[]).map(r=>r.status),['awaiting','awaiting']);
 const exact=dispatchDocumentRows(d,[board({deliveries:[delivery],qcJob:ack})],[],[file('do'),file('ack')],[]);
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
test('Parent DO uses per-site signoffs and acknowledgments, no customer signature on internal pool; closed pools leave queue',()=>{
 const d=dispatch('parent',[cable],true),b=board({qcJob:{...ack,variableSignoff:{id:'vso'}}});
 const row=dispatchDocumentRows([d],[b],[],[file('ack'),file('vso')],[])[0];assert.equal(row.status,'ready');
 assert.deepEqual(row.sites[0].documents.map(v=>v.label),['Variable Items Sign Off','Acknowledgment']);
 assert.match(row.reconciliationStatus,/returns require reconciliation/);
 assert.equal(dispatchDocumentRows([d],[b],[],[file('ack'),file('vso')],[],new Set(['draft'])).length,0);
});
test('same PO, IPO text, customer or site name never substitutes for exact native/registered identity',()=>{
 assert.equal(dispatchBoard(site,[{site_id:'wrong',snapshot:{...site}}]),undefined);
 assert.equal(dispatchBoard({...site,registeredSiteId:undefined},[{site_id:'right',snapshot:{origin:{ipoId:'ipo-one'}}}])?.site_id,'right');
 assert.equal(dispatchBoard({...site,registeredSiteId:undefined},[{site_id:'a',snapshot:{origin:{ipoId:'ipo-one'}}},{site_id:'b',snapshot:{origin:{ipoId:'ipo-one'}}}]),undefined);
 const d=dispatch();d.snapshot.sites=[{...site,installation:false}];assert.equal(dispatchDocumentRows([d],[board({installation:false,deliveries:[delivery]})],[],[file('do')],[])[0].status,'ready');
});
