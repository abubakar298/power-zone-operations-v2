import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {groupDispatchDocumentSites} from '../shared/dispatch-document-status.js';
import {MaterialDraftRepository} from '../server/inventory/material-drafts.js';
import {MaterialStockRepository} from '../server/inventory/material-stock.js';
import {MaterialUsageRepository} from '../server/inventory/material-usage.js';
import {ParentReconciliationRepository} from '../server/inventory/parent-reconciliation.js';
import {readDispatchSiteRemovals} from '../server/inventory/dispatch-site-removals.js';
import {WarehouseAuthorityRepository,warehousePosition} from '../server/inventory/warehouse-ledger.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import {batchSchema} from '../server/operations-board/schema.js';
import {testDatabase} from './database.js';
import {materialStockFixture} from './material-stock-fixture.js';
import {readWorkflowSite} from './operations-snapshot.js';

test('explicit Operations cancellation reconciles only the referenced posted trip and only after signed counted returns',async()=>{
 const {pool,close}=await testDatabase();
 try{
  const itemId='CH-CBL-AC-16MM/4C-PK',warehouse='Lahore warehouse';
  const {owner,stockSha,key}=await materialStockFixture(pool,itemId);
  const operations=new OperationsBoardRepository(pool),drafts=new MaterialDraftRepository(pool);
  const stock=new MaterialStockRepository(pool),usage=new MaterialUsageRepository(pool),ledger=new ParentReconciliationRepository(pool);
  const date=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Karachi'});
  await new WarehouseAuthorityRepository(pool).command(owner,{warehouse,version:0,sourceSha256:stockSha,state:'active',reason:'Fixture baseline',requestKey:randomUUID()});
  const customer=(await pool.query('SELECT id FROM customers ORDER BY id LIMIT 1')).rows[0].id;
  async function site(id:string){
   const siteId=randomUUID(),po=randomUUID();
   await pool.query('INSERT INTO customer_purchase_orders(id,customer_id,po_number,input,created_by) VALUES($1,$2,$3,$4,$5)',[po,customer,id,{},owner]);
   await pool.query('INSERT INTO internal_purchase_orders(id,customer_po_id,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[siteId,po,id,{},'a'.repeat(64),randomUUID(),owner]);
   return {siteId,registeredSiteId:id,basisId:randomUUID(),basisVersion:1,siteName:id,ipo:id,customer:'Fixture',installation:true,dispatchDate:date};
  }
  const delayed=await site('Delayed'),delivered=await site('Delivered');
  await operations.importSource(owner,{sourceSha256:'d'.repeat(64),rows:[delayed,delivered].map(s=>({id:s.registeredSiteId,ipo:s.ipo,name:s.siteName,stage:'received',projectType:'ups',installation:true,operationsTeam:'central'}))});
  const checksum='a'.repeat(64);
  let revision=0,closing=7;
  async function issue(number:string,sites:(typeof delayed)[],quantity:number,options:{parent?:boolean;posted?:boolean;draft?:{draftId:string;lineKey:string}}={}){
   const {parent=false,posted=true,draft}=options;
   const id=randomUUID(),draftId=draft?.draftId??randomUUID(),lineKey=draft?.lineKey??randomUUID(),requestKey=randomUUID();
   const snapshot={parent,kind:'variable',warehouse,sites,lines:[{key:lineKey,itemId,description:'AC cable',unit:'m',out:String(quantity),sites:sites.map(s=>s.siteId)}]};
   if(!draft){
    await pool.query('INSERT INTO inventory_material_drafts(id,created_by) VALUES($1,$2)',[draftId,owner]);
    await pool.query('INSERT INTO inventory_material_draft_versions(draft_id,version,snapshot,request_key,request_fingerprint,created_by) VALUES($1,1,$2,$3,$4,$5)',[draftId,snapshot,requestKey,checksum,owner]);
   }
   await pool.query('INSERT INTO inventory_material_dispatches(id,number,draft_id,draft_version,source_sha256,warehouse,snapshot,request_key,request_fingerprint,created_by) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9)',[id,number,draftId,stockSha,warehouse,snapshot,requestKey,checksum,owner]);
   await pool.query('INSERT INTO inventory_material_dispatch_lines(dispatch_id,line_key,source_sha256,ledger_key,item_id,unit,description,quantity) VALUES($1,$2,$3,$4,$5,\'m\',\'AC cable\',$6)',[id,lineKey,stockSha,key,itemId,quantity]);
   if(posted){
    await pool.query("INSERT INTO inventory_warehouse_operational_movements(id,source_sha256,ledger_key,ledger_revision,kind,draft_id,dispatch_id,line_key,in_delta,out_delta,closing_before,closing_after,created_by) VALUES($1,$2,$3,$4,'dispatch-out',$5,$6,$7,0,$8,$9,$10,$11)",[randomUUID(),stockSha,key,++revision,draftId,id,lineKey,quantity,closing,closing-quantity,owner]);
    closing-=quantity;
   }
   return {id,number,draftId,lineKey,snapshot};
  }
  const parent=await issue('TEST-PDO-1',[delayed,delivered],3,{parent:true});
  const individual=await issue('TEST-DO-1',[delayed],1);
  const unrelated=await issue('TEST-DO-10',[delayed],1);
  const evidenced=await issue('TEST-DO-2',[delayed],1);
  const unposted=await issue('TEST-DO-3',[delayed],1,{posted:false});
  const tripReferences=[parent,individual,evidenced,unposted].map(d=>d.number).join(', ');
  const original=batchSchema.parse({version:0,requestKey:randomUUID(),team:'central',kind:'delivery',deliveryDate:date,vehicle:'Fixture',driver:'Fixture',
   inventoryReference:tripReferences,stops:[delayed,delivered].map((s,i)=>({siteId:s.registeredSiteId,siteVersion:1,order:i+1,plannedDate:date}))});
  const batch=await operations.saveBatch(owner,original);
  const version=async(id:string)=>(await readWorkflowSite(operations,owner,id)).version;
  const report={state:'signed',workflowVersion:2,lines:[{lineKey:parent.lineKey,issued:null,used:'2',returned:null}]};
  async function saveReport(draftId:string,siteId:string,snapshot:object){
   await pool.query('INSERT INTO inventory_material_site_usage_versions(draft_id,site_id,version,snapshot,reason,request_key,request_fingerprint,created_by) VALUES($1,$2,1,$3,$4,$5,$6,$7)',[draftId,siteId,snapshot,'Fixture evidence',randomUUID(),checksum,owner]);
  }
  await saveReport(parent.draftId,delivered.siteId,report);
  await saveReport(evidenced.draftId,delayed.siteId,{...report,lines:[{lineKey:evidenced.lineKey,issued:'1',used:'1',returned:null}]});
  assert.equal((await usage.read(owner,parent.draftId)).reconciliation?.rows[0].used,null);
  assert.deepEqual(await readDispatchSiteRemovals(pool,[parent.id]),[],'A scheduled trip does not waive QC usage.');
  const removal={...original,id:batch.id,version:1,edit:true,requestKey:randomUUID(),reason:'Customer postponed delivery en route',
   cancelledSites:[{siteId:delayed.registeredSiteId,siteVersion:await version(delayed.registeredSiteId)}],
   stops:[{...original.stops[1],siteVersion:await version(delivered.registeredSiteId),order:1}]};
  await operations.saveBatch(owner,removal);
  assert.equal((await operations.saveBatch(owner,removal)).version,2);
  assert.equal((await readWorkflowSite(operations,owner,delayed.registeredSiteId)).stage,'received');
  const next=await issue('TEST-DO-4',[delayed],1);
  const matches=await readDispatchSiteRemovals(pool,[parent.id,individual.id,unrelated.id,evidenced.id,unposted.id,next.id]);
  assert.deepEqual(new Set(matches.map(r=>r.dispatchId)),new Set([parent.id,individual.id]));
  assert.ok(matches.every(r=>r.siteId===delayed.siteId&&r.batchNumber===batch.number));
  const queue=await drafts.documentStatus(owner);
  const delayedRow=groupDispatchDocumentSites(queue.rows).find(r=>r.id===delayed.registeredSiteId)!;
  assert.equal(delayedRow.status,'awaiting','Other trips still need QC.');
  assert.deepEqual(new Set(delayedRow.dispatches.filter(d=>d.site.removedByOperations).map(d=>d.dispatch.id)),new Set([parent.id,individual.id]));
  const current=await ledger.read(owner,parent.draftId);
  assert.equal(current.reconciliation?.rows[0].warehouseOut,'3');
  assert.equal(current.reconciliation?.rows[0].used,'2');
  assert.equal(current.reconciliation?.rows[0].expectedReturn,'1');
  assert.deepEqual(current.reports.map(r=>r.site_id),[delivered.siteId]);
  const closeParent={id:parent.draftId,version:0,draftVersion:1,action:'close',reason:'Fixture close',requestKey:randomUUID()};
  await assert.rejects(ledger.change(owner,closeParent),/verified warehouse returns/);
  assert.equal((await warehousePosition(pool,stockSha,key))?.currentClosing,'0','Operations removal makes no stock movement.');
  const evidence=await stock.uploadEvidence(owner,{warehouse,filename:'signed-count.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7 fictional signed count').toString('base64')});
  const receive={draftId:individual.draftId,sourceSha256:stockSha,authorityVersion:1,evidenceId:evidence.id,reason:'Signed and counted fixture',requestKey:randomUUID(),
   qcUsageVersions:[],lines:[{lineKey:individual.lineKey,quantity:'1',ledgerRevision:revision}]};
  await assert.rejects(stock.receive(owner,{...receive,draftId:unrelated.draftId,lines:[{...receive.lines[0],lineKey:unrelated.lineKey}]}),/QC must save/);
  const returned=await stock.receive(owner,receive);
  assert.deepEqual(await stock.receive(owner,receive),returned);
  await assert.rejects(stock.receive(owner,{...receive,requestKey:randomUUID()}),/already been credited/);
  assert.equal((await ledger.read(owner,individual.draftId,undefined,true)).reconciliation?.ready,true);
  const parentEvidence=await stock.uploadEvidence(owner,{warehouse,filename:'pool-count.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7 fictional signed pool count').toString('base64')});
  await stock.receive(owner,{...receive,draftId:parent.draftId,evidenceId:parentEvidence.id,requestKey:randomUUID(),qcUsageVersions:[{siteId:delivered.siteId,version:1}],
   lines:[{lineKey:parent.lineKey,quantity:'1',ledgerRevision:revision+1}]});
  assert.equal((await ledger.change(owner,closeParent)).status,'closed');
  assert.equal((await ledger.read(owner,parent.draftId)).state.snapshot.siteRemovals[0].dispatchId,parent.id);
  assert.equal((await warehousePosition(pool,stockSha,key))?.currentClosing,'2');
  assert.deepEqual((await pool.query('SELECT snapshot FROM inventory_material_dispatches WHERE id=$1',[individual.id])).rows[0].snapshot,individual.snapshot);
 }finally{await close();}
});
