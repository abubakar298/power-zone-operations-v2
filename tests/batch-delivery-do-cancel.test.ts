import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import {batchSchema} from '../server/operations-board/schema.js';
import {warehousePosition} from '../server/inventory/warehouse-ledger.js';
import {testDatabase} from './database.js';
import {materialStockFixture} from './material-stock-fixture.js';
import {readWorkflowSite} from './operations-snapshot.js';

test('cancelling a delivery cancels only the site DOs that have not left the warehouse, with the reason',async()=>{
 const {pool,close}=await testDatabase();
 try{
  const itemId='CH-CBL-AC-16MM/4C-PK',warehouse='Lahore warehouse',checksum='a'.repeat(64);
  const {owner,stockSha,key}=await materialStockFixture(pool,itemId);
  const repo=new OperationsBoardRepository(pool),ids=['delivery-off','other-site','kept-delivery'];
  await repo.importSource(owner,{sourceSha256:'e'.repeat(64),rows:ids.map(id=>({id,ipo:'IPO-'+id,name:'Site '+id,stage:'received' as const,projectType:'ups' as const,installation:true,operationsTeam:'central' as const}))});
  // Two DOs for the site: one printed but not signed at the gate, one already posted (stock left).
  async function issue(number:string,site:string,posted:boolean){
   const id=randomUUID(),draftId=randomUUID(),lineKey=randomUUID();
   const snapshot={parent:false,kind:'fixed',warehouse,sites:[{siteId:randomUUID(),registeredSiteId:site,siteName:site,ipo:'IPO-'+site}],lines:[{key:lineKey,itemId,description:'AC cable',unit:'m',out:'1',sites:[]}]};
   await pool.query('INSERT INTO inventory_material_drafts(id,created_by) VALUES($1,$2)',[draftId,owner]);
   await pool.query('INSERT INTO inventory_material_draft_versions(draft_id,version,snapshot,request_key,request_fingerprint,created_by) VALUES($1,1,$2,$3,$4,$5)',[draftId,snapshot,randomUUID(),checksum,owner]);
   await pool.query('INSERT INTO inventory_material_dispatches(id,number,draft_id,draft_version,source_sha256,warehouse,snapshot,request_key,request_fingerprint,created_by) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9)',[id,number,draftId,stockSha,warehouse,snapshot,randomUUID(),checksum,owner]);
   await pool.query("INSERT INTO inventory_material_dispatch_lines(dispatch_id,line_key,source_sha256,ledger_key,item_id,unit,description,quantity) VALUES($1,$2,$3,$4,$5,'m','AC cable',1)",[id,lineKey,stockSha,key,itemId]);
   await pool.query("INSERT INTO inventory_signed_dispatch_pending(document_kind,document_id,warehouse,source_sha256,authority_version,movements,created_by) VALUES('dispatch',$1,$2,$3,1,$4,$5)",[id,warehouse,stockSha,JSON.stringify([{ledgerKey:key,quantity:'1',kind:'dispatch-out',draftId,dispatchId:id,lineKey}]),owner]);
   if(posted)await pool.query("INSERT INTO inventory_warehouse_operational_movements(id,source_sha256,ledger_key,ledger_revision,kind,draft_id,dispatch_id,line_key,in_delta,out_delta,closing_before,closing_after,created_by) VALUES($1,$2,$3,1,'dispatch-out',$4,$5,$6,0,1,7,6,$7)",[randomUUID(),stockSha,key,draftId,id,lineKey,owner]);
   return id;
  }
  const unsigned=await issue('TEST-DO-UNSIGNED','delivery-off',false),posted=await issue('TEST-DO-POSTED','delivery-off',true),otherSite=await issue('TEST-DO-OTHER','other-site',false),keptByRoute=await issue('TEST-DO-KEPT','kept-delivery',false);
  const stops=async(kinds:Record<string,'both'|'labour'>,plannedDate='2026-12-02')=>Promise.all(Object.entries(kinds).map(async([siteId,kind],n)=>({siteId,siteVersion:(await readWorkflowSite(repo,owner,siteId)).version,order:n+1,kind,plannedDate,start:'',end:''})));
  const plan={team:'central',kind:'both',deliveryDate:'2026-12-01',vehicle:'DO-1',driver:'Driver',labourTeam:'pz-team'};
  const saved=await repo.saveBatch(owner,batchSchema.parse({...plan,version:0,requestKey:randomUUID(),stops:await stops({'delivery-off':'both','other-site':'both','kept-delivery':'both'})}));
  // A second batch still delivers to 'kept-delivery', so its DO must stay.
  const second=await repo.saveBatch(owner,batchSchema.parse({...plan,vehicle:'DO-2',deliveryDate:'2026-12-03',version:0,requestKey:randomUUID(),stops:await stops({'kept-delivery':'both','other-site':'both'},'2026-12-04')}));
  assert.ok(second.id);
  const edit=batchSchema.parse({...plan,id:saved.id,version:1,edit:true,requestKey:randomUUID(),reason:'Customer gate closed; delivery moves to another day',stops:await stops({'delivery-off':'labour','other-site':'both','kept-delivery':'labour'})});
  const closing=(await warehousePosition(pool,stockSha,key))?.currentClosing;
  await repo.saveBatch(owner,edit);
  const state=async(id:string)=>(await pool.query('SELECT snapshot FROM inventory_material_dispatches WHERE id=$1',[id])).rows[0].snapshot;
  assert.equal((await state(unsigned)).cancelled,true,'the DO not yet signed at the gate is cancelled');
  assert.equal((await state(posted)).cancelled,undefined,'a DO whose stock left the warehouse is kept');
  assert.equal((await state(otherSite)).cancelled,undefined,'other sites in the batch are untouched');
  assert.equal((await state(keptByRoute)).cancelled,undefined,'a site still delivered by another batch keeps its DO');
  const revision=(await pool.query('SELECT action,reason,created_by FROM inventory_material_dispatch_revisions WHERE dispatch_id=$1',[unsigned])).rows;
  assert.deepEqual(revision.map(r=>[r.action,r.created_by]),[['delete',owner]]);assert.match(revision[0].reason,/delivery cancelled by Operations\. Reason: Customer gate closed/);
  assert.equal((await warehousePosition(pool,stockSha,key))?.currentClosing,closing,'cancelling an unsigned DO moves no stock');
  const site=await readWorkflowSite(repo,owner,'delivery-off');
  assert.equal(site.dispatchDate,undefined,'the cancelled delivery date is cleared');assert.equal(site.stage,'received');assert.equal(site.installationPlanDate,'2026-12-02','installation stays planned');
  assert.match(site.history.at(-1)!.description,/DO TEST-DO-UNSIGNED cancelled automatically .*DO TEST-DO-POSTED already left the warehouse/);
  assert.doesNotMatch((await readWorkflowSite(repo,owner,'kept-delivery')).history.at(-1)!.description,/cancelled automatically/);
  assert.equal((await repo.saveBatch(owner,edit)).version,2,'retrying the edit changes nothing more');
  assert.equal((await pool.query('SELECT count(*)::int n FROM inventory_material_dispatch_revisions')).rows[0].n,1);
 }finally{await close();}
});

test('removing a site from a batch, or deleting the batch, cancels its unsigned DOs and holds the VSO and acknowledgment',async()=>{
 const {pool,close}=await testDatabase();
 try{
  const itemId='CH-CBL-AC-16MM/4C-PK',warehouse='Lahore warehouse',checksum='a'.repeat(64);
  const {owner,stockSha,key}=await materialStockFixture(pool,itemId);
  const repo=new OperationsBoardRepository(pool),ids=['removed','stays','deleted-a','deleted-b'];
  await repo.importSource(owner,{sourceSha256:'9'.repeat(64),rows:ids.map(id=>({id,ipo:'IPO-'+id,name:'Site '+id,stage:'received' as const,projectType:'ups' as const,installation:true,operationsTeam:'central' as const}))});
  async function issue(number:string,site:string){
   const id=randomUUID(),draftId=randomUUID(),lineKey=randomUUID();
   const snapshot={parent:false,kind:'fixed',warehouse,sites:[{siteId:randomUUID(),registeredSiteId:site,siteName:site,ipo:'IPO-'+site}],lines:[{key:lineKey,itemId,description:'AC cable',unit:'m',out:'1',sites:[]}]};
   await pool.query('INSERT INTO inventory_material_drafts(id,created_by) VALUES($1,$2)',[draftId,owner]);
   await pool.query('INSERT INTO inventory_material_draft_versions(draft_id,version,snapshot,request_key,request_fingerprint,created_by) VALUES($1,1,$2,$3,$4,$5)',[draftId,snapshot,randomUUID(),checksum,owner]);
   await pool.query('INSERT INTO inventory_material_dispatches(id,number,draft_id,draft_version,source_sha256,warehouse,snapshot,request_key,request_fingerprint,created_by) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9)',[id,number,draftId,stockSha,warehouse,snapshot,randomUUID(),checksum,owner]);
   await pool.query("INSERT INTO inventory_material_dispatch_lines(dispatch_id,line_key,source_sha256,ledger_key,item_id,unit,description,quantity) VALUES($1,$2,$3,$4,$5,'m','AC cable',1)",[id,lineKey,stockSha,key,itemId]);
   await pool.query("INSERT INTO inventory_signed_dispatch_pending(document_kind,document_id,warehouse,source_sha256,authority_version,movements,created_by) VALUES('dispatch',$1,$2,$3,1,$4,$5)",[id,warehouse,stockSha,JSON.stringify([{ledgerKey:key,quantity:'1',kind:'dispatch-out',draftId,dispatchId:id,lineKey}]),owner]);
   return id;
  }
  const dos=Object.fromEntries(await Promise.all(ids.map(async id=>[id,await issue('TEST-DO-'+id,id)])));
  const stops=async(list:string[])=>Promise.all(list.map(async(siteId,n)=>({siteId,siteVersion:(await readWorkflowSite(repo,owner,siteId)).version,order:n+1,kind:'both' as const,plannedDate:'2026-12-02',start:'',end:''})));
  const plan={team:'central',kind:'both',deliveryDate:'2026-12-01',vehicle:'RM-1',driver:'Driver',labourTeam:'pz-team'};
  const first=await repo.saveBatch(owner,batchSchema.parse({...plan,version:0,requestKey:randomUUID(),stops:await stops(['removed','stays'])}));
  await repo.saveBatch(owner,batchSchema.parse({...plan,id:first.id,version:1,edit:true,requestKey:randomUUID(),reason:'Customer cancelled this visit',
   cancelledSites:[{siteId:'removed',siteVersion:(await readWorkflowSite(repo,owner,'removed')).version}],stops:await stops(['stays'])}));
  const cancelled=async(id:string)=>(await pool.query('SELECT snapshot FROM inventory_material_dispatches WHERE id=$1',[id])).rows[0].snapshot.cancelled===true;
  assert.equal(await cancelled(dos.removed),true);assert.equal(await cancelled(dos.stays),false);
  const removed=await readWorkflowSite(repo,owner,'removed') as any;
  assert.equal(removed.installationHold.kind,'cancelled');assert.equal(removed.installationHold.reason,'Customer cancelled this visit');
  assert.match(removed.history.at(-1).description,/site cancelled from batch\. Reason: Customer cancelled this visit DO TEST-DO-removed cancelled automatically/);
  const second=await repo.saveBatch(owner,batchSchema.parse({...plan,vehicle:'RM-2',deliveryDate:'2026-12-05',version:0,requestKey:randomUUID(),stops:(await stops(['deleted-a','deleted-b'])).map(s=>({...s,plannedDate:'2026-12-06'}))}));
  await repo.deleteBatch(owner,{id:second.id,version:1,requestKey:randomUUID(),reason:'Vehicle unavailable'});
  assert.equal(await cancelled(dos['deleted-a']),true);assert.equal(await cancelled(dos['deleted-b']),true);
  assert.equal((await readWorkflowSite(repo,owner,'deleted-a') as any).installationHold.reason,'Vehicle unavailable');
 }finally{await close();}
});
