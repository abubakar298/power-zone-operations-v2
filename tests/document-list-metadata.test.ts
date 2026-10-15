import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {loadDocumentListMetadata,snapshotListMetadata} from '../server/documents/list-metadata.js';
import {DocumentListDetails} from '../web/components/DocumentListDetails.js';
import {matchesWorkspace,emptyWorkspaceFilters} from '../web/components/WorkspaceFilters.js';
import {documentListSearch} from '../shared/document-list-search.js';
import {testDatabase} from './database.js';import {createDashboardSamples} from '../server/coordinator/samples.js';import {CoordinatorRepository} from '../server/coordinator/repository.js';import {CommercialRepository} from '../server/commercial/repository.js';

test('saved payable and four solution families display and search consistently, with honest missing values',()=>{
 for(const[family,label]of [['solar-hybrid','Solar Hybrid'],['bess-only','BESS Only'],['direct-product','Direct Sale'],['cni','C&I']]){
 const record=snapshotListMetadata({footer:[{label:'Subtotal Before Tax',amount:'1800000'},{label:'Net Total',amount:'1990000.00'}]},family);
 assert.equal(record.solutionType,label);assert.equal(record.documentAmount,'1990000.00');
 const html=renderToStaticMarkup(createElement(DocumentListDetails,{record}));assert.match(html,/1,990,000.00/);assert.ok(html.includes(label==='C&I'?'C&amp;I':label));
 for(const search of ['1990000','1,990,000',label])assert.equal(matchesWorkspace(record,{...emptyWorkspaceFilters,search}),true);
 assert.match(documentListSearch(record),/1990000/);
 }
 assert.deepEqual(snapshotListMetadata({}),{documentAmount:null,solutionType:'Not recorded'});
 assert.equal(snapshotListMetadata({allocation:{total:'0.00'}},'bess-only').documentAmount,'0.00');
 assert.equal(snapshotListMetadata({allocation:{total:'7800000.00'}},'solar-hybrid').documentAmount,'7800000.00');
 assert.equal(snapshotListMetadata({pricing:{payable:'1990000.00'}},'cni').documentAmount,'1990000.00');
 assert.equal(snapshotListMetadata({netTotal:'1990000.00'},'direct-product').documentAmount,'1990000.00');
 assert.match(renderToStaticMarkup(createElement(DocumentListDetails,{record:{}})),/Amount not available/);
});

test('authorized Coordinator lists project saved quote, revision, pricing and IPO amounts without modifying any document snapshots',async()=>{
 const db=await testDatabase();try{
 const owner=randomUUID(),manager=randomUUID();for(const[id,role]of [[owner,'Coordinator'],[manager,'Management']])await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated',$4)",[id,id+'@example.test',role,role]);
 const samples=await createDashboardSamples(db.pool,owner,manager),repo=new CommercialRepository(db.pool),source=await repo.quotationGet(samples.find((r:any)=>r.stage===4)!.quotationId),original=JSON.stringify(source.snapshot);
 const revision=await repo.revisionStart(manager,source.id,'Internal management',false,'Display test','Director',randomUUID(),'return');
 const cni=randomUUID();await db.pool.query('INSERT INTO cni_proposals(id,created_by,customer_id) VALUES($1,$2,3)',[cni,owner]);
 await db.pool.query("INSERT INTO cni_proposal_versions(id,proposal_id,version,number,snapshot,internal_cost_snapshot,created_by) VALUES($1,$2,1,'ISOLATED-CNI-DISPLAY',$3,'{}',$4)",[randomUUID(),cni,{pricing:{payable:'15000000.00'}},owner]);
 const ids=samples.flatMap((r:any)=>[r.quotationId,r.ipoId,r.pricingId].filter(Boolean)).concat(revision.id,source.pricing_id,cni);
 const metadata=await loadDocumentListMetadata(db.pool,ids),payable=source.snapshot.footer.at(-1).amount;
 assert.equal(metadata.get(source.id)?.documentAmount,payable);assert.equal(metadata.get(revision.id)?.documentAmount,payable);assert.equal(metadata.get(revision.id)?.solutionType,'Solar Hybrid');assert.ok(metadata.get(source.pricing_id)?.documentAmount);
 assert.deepEqual(metadata.get(cni),{documentAmount:'15000000.00',solutionType:'C&I'});
 const overview=await new CoordinatorRepository(db.pool).overview(owner,false,true),task=overview.tasks.find((t:any)=>t.id===revision.id);assert.equal(task.documentAmount,payable);assert.equal(task.solutionType,'Solar Hybrid');
 for(const sample of samples.filter((r:any)=>r.ipoId)){
 const stored=(await db.pool.query('SELECT snapshot FROM internal_purchase_orders WHERE id=$1',[sample.ipoId])).rows[0];
 assert.equal(metadata.get(sample.ipoId)?.documentAmount,stored.snapshot.allocation.total);assert.equal(metadata.get(sample.ipoId)?.solutionType,'Solar Hybrid');
 }
 const {ProjectWorkflowRepository}=await import('../server/project-workflow/repository.js');
 const linked=randomUUID(),fixed=randomUUID();
 for(const[id,data,route,stage]of [[linked,{quotationId:source.id},'quick-quote','commercial_revision'],[fixed,{basis:{boq:{survey:{family:'solar-hybrid'}},order:{allocation:{total:'7800000.00'}}}},'survey-framework','customer_tracking']] as const)
 await db.pool.query("INSERT INTO project_workflow_records(id,customer_id,site_name,site_code,route,stage,coordinator_id,data,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$7)",[id,source.snapshot.customer.id,'Isolated '+id,id.slice(0,8),route,stage,owner,data,randomUUID()]);
 const list:any=await new ProjectWorkflowRepository(db.pool).list(owner,'coordination','mine');
 assert.equal(list.records.find((r:any)=>r.id===linked)?.documentAmount,payable);
 assert.equal(list.records.find((r:any)=>r.id===fixed)?.documentAmount,'7800000.00');
 assert.equal(list.records.find((r:any)=>r.id===fixed)?.solutionType,'Solar Hybrid');
 assert.equal(JSON.stringify((await repo.quotationGet(source.id)).snapshot),original);assert.equal((await loadDocumentListMetadata(db.pool,[])).size,0);
 }finally{await db.close();}
});
