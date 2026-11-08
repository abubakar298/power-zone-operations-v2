import {test} from 'node:test';
import assert from 'node:assert/strict';
import {materialUsageHolds,qcMaterialHandoff} from '../server/accounts/qc-material-handoff.js';
import {historicalClosureException,historicalClosureJobKeys} from '../shared/historical-closure-exceptions.js';
import {testDatabase} from './database.js';
import {AccountsRepository} from '../server/accounts/repository.js';
import {InventoryRepository} from '../server/inventory/repository.js';
import {randomUUID} from 'node:crypto';
const base={deliveryOnly:false,completed:true,signedDos:1,localDeclared:true,drafts:[{kind:'fixed',parent:false,lineKeys:['x'],usage:{state:'signed',lines:[{lineKey:'x',used:'0'}]}}]};
test('QC handoff uses every applicable issued line, explicit zero and local declaration, without photos or returns',()=>{
 assert.deepEqual(materialUsageHolds(base),[]);
 assert.deepEqual(materialUsageHolds({...base,drafts:[...base.drafts,{kind:'variable',parent:false,lineKeys:[],usage:null}]}),[],'Empty unused drafts never block');
 assert.match(materialUsageHolds({...base,drafts:[...base.drafts,{kind:'variable',parent:true,lineKeys:['v'],usage:null}]}).join(';'),/Parent DO variable usage pending/);
 assert.match(materialUsageHolds({...base,localDeclared:false}).join(';'),/local purchases/);
 assert.deepEqual(materialUsageHolds({...base,deliveryOnly:true,drafts:[],localDeclared:false}),[],'Delivery-only needs no installation usage or local declaration');
 assert.deepEqual(materialUsageHolds({...base,deliveryOnly:true,signedDos:0}),['Signed DO pending']);
 assert.deepEqual(materialUsageHolds({...base,noVariableItemsUsed:true,drafts:[{kind:'variable',parent:true,lineKeys:['v'],usage:{state:'signed',lines:[{lineKey:'v',used:'0'}]}}]}),[],'Confirmed zero variable use needs no invented VSO');
 assert.deepEqual(materialUsageHolds({...base,signedDos:0,drafts:[],noWarehouseMaterials:true}),[],'Explicit installation-only scope has no invented material DO prerequisite');
 assert.equal(historicalClosureJobKeys.size,21);
 assert.equal(historicalClosureException('ubl:39'),true);
 assert.equal(historicalClosureException('ipo:'+randomUUID()),false,'A future UBL site never inherits the exception');
});
test('historical closure submits without photographs or PT file, permits later append only, and does not post stock',async()=>{
 const db=await testDatabase();try{
  const owner=randomUUID(),accounts=randomUUID();
  for(const [id,role] of [[owner,'Management'],[accounts,'Accounts']])await db.pool.query('INSERT INTO users(id,email,display_name,password_hash,role)VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role,'not-a-login',role]);
  const inv=new InventoryRepository(db.pool),repo=new AccountsRepository(db.pool),key='ubl:39';
  const job=await inv.job(owner,key),reportId=randomUUID(),versionId=randomUUID();
  const entry={start:'2026-10-01',end:'2026-10-02',panelCount:'57',panelWattage:'620',usage:Object.fromEntries(job.lines.filter(l=>l.group!=='watt').map(l=>[l.key,l.approved])),remarks:'Verified historical entry',expectedReturns:'',receivedReturns:'',extra:[]};
  const {reconcile}=await import('../server/inventory/reconciliation.js');
  await db.pool.query('INSERT INTO inventory_reports(id,job_key,created_by) VALUES($1,$2,$3)',[reportId,key,owner]);
  await db.pool.query("INSERT INTO inventory_report_versions(id,report_id,version,stage,snapshot,request_key,created_by)VALUES($1,$2,1,'Sent to Accounts',$3,$4,$5)",[versionId,reportId,{...job,entry,reconciliation:reconcile(job.lines,entry)},randomUUID(),owner]);
  await db.pool.query("INSERT INTO accounts_pt_entries(id,source_kind,source_id,source_version,pt_reference,entry_date,notes,created_by)VALUES($1,'Inventory',$2,1,'PT verified','2026-11-07','Fixture',$3)",[randomUUID(),reportId,accounts]);
  const input={jobKey:key,version:0,stage:'Awaiting Management' as const,actual:{'Solar Panels':'1',Structure:'1',Inverter:'1',Batteries:'1',BMS:'1'},epc:{},epcAggregate:'1',remarks:'Owner historical exception',acknowledgment:'',photos:'',ptReference:'',ptAttachmentId:null,operationsEvidenceSignature:null,requestKey:randomUUID()};
  const saved=await repo.saveClosure(accounts,input);assert.equal(saved.stage,'Awaiting Management');assert.equal(saved.snapshot.historicalEvidenceException,true);
  const before=JSON.stringify(saved.snapshot),bytes=Buffer.from('%PDF-1.7\nSupplementary PT report');
  await repo.uploadEvidence(accounts,key,'late-pt.pdf','application/pdf',bytes.toString('base64'));
  assert.equal(JSON.stringify((await db.pool.query('SELECT snapshot FROM accounts_job_closures WHERE id=$1',[saved.id])).rows[0].snapshot),before);
  assert.equal((await repo.job(accounts,key)).evidence.some((e:any)=>e.filename==='late-pt.pdf'),true);
  await repo.decision(owner,{id:saved.id,version:saved.version,decision:'Closed',notes:'Reviewed actual costs',requestKey:randomUUID()});
  await repo.uploadEvidence(accounts,key,'late-do.pdf','application/pdf',bytes.toString('base64'),'Signed DO');
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM stock_on_hand_entries')).rows[0].n,0);
  assert.equal(await qcMaterialHandoff(db.pool,'ipo:'+randomUUID()),null);
 }finally{await db.close();}
});
test('native QC material handoff uses existing PT, permits no-photo closure and never creates an Inventory report',async()=>{
 const db=await testDatabase();try{
  const owner=randomUUID(),coord=randomUUID(),account=randomUUID();
  for(const [id,role] of [[owner,'Admin'],[coord,'Coordinator'],[account,'Accounts']])await db.pool.query('INSERT INTO users(id,email,display_name,password_hash,role)VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role,'not-a-login',role]);
  const {createDashboardSamples}=await import('../server/coordinator/samples.js');
  const examples=await createDashboardSamples(db.pool,coord,owner),sample=examples.find((r:any)=>r.ipoId)!;
  const key='ipo:'+sample.ipoId,boardId='native-handoff-'+randomUUID(),file=randomUUID();
  await db.pool.query('INSERT INTO operations_board_sites(id,created_by)VALUES($1,$2)',[boardId,owner]);
  await db.pool.query("INSERT INTO operations_board_files(id,site_id,filename,media_type,sha256,content,created_by)VALUES($1,$2,'signed-do.pdf','application/pdf',$3,$4,$5)",[file,boardId,'a'.repeat(64),Buffer.from('%PDF-1.7 signed'),owner]);
  const board={id:boardId,name:'Native handoff fixture',ipo:'Exact fixture',customer:'UBL',origin:{ipoId:sample.ipoId},stage:'delivered',installation:true,completed:false,projectType:'ups',operationsTeam:'central',deliveries:[{signedDo:{id:file},deliveryDate:'2026-11-01',partial:false}],documents:[]};
  await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by)VALUES($1,1,$2,'Fixture','Fixture',$3,$4)",[boardId,board,randomUUID(),owner]);
  assert.match((await qcMaterialHandoff(db.pool,key))!.holds.join(';'),/material linkage/);
  await db.pool.query("INSERT INTO operations_site_local_purchase_versions(site_id,version,snapshot,request_key,request_fingerprint,created_by)VALUES($1,1,$2,$3,$4,$5)",[boardId,{items:[],noWarehouseMaterials:true,destination:'Accounts',stockPosting:false},randomUUID(),'b'.repeat(64),owner]);
  const source=await qcMaterialHandoff(db.pool,key);assert.equal(source?.ready,true,'Explicit no-material declaration and signed DO; no pictures required');
  await db.pool.query("INSERT INTO accounts_job_pt_entries(id,job_key,site_id,pt_reference,entry_date,notes,snapshot,request,request_key,created_by)VALUES($1,$2,$3,'PT-already-entered','2026-11-01','Fixture',$4,'{}',$5,$6)",[randomUUID(),'site:'+boardId,boardId,{siteName:'Native handoff fixture'},randomUUID(),account]);
  const repo=new AccountsRepository(db.pool),job=await repo.job(account,key);assert.equal(job.reportVersionId,null);assert.equal(job.qcMaterialSignature,source!.signature);
  const input={jobKey:key,version:0,stage:'Awaiting Management' as const,actual:{'Solar Panels':'1',Structure:'1',Inverter:'1',Batteries:'1',BMS:'1'},epc:{},epcAggregate:'1',remarks:'Verified PT costs',acknowledgment:'',photos:'',ptReference:'PT-already-entered',ptAttachmentId:null,qcMaterialSignature:job.qcMaterialSignature,requestKey:randomUUID()};
  await assert.rejects(repo.saveClosure(account,input),/PT costing report/,'Future site cannot inherit historical PT exception');
  const pt=await repo.uploadEvidence(account,key,'pt.pdf','application/pdf',Buffer.from('%PDF-1.7 PT').toString('base64'));
  const saved=await repo.saveClosure(account,{...input,ptAttachmentId:pt.id});assert.equal(saved.report_version_id,null);assert.equal(saved.snapshot.qcMaterialSource.ready,true);
  await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by)VALUES($1,2,$2,'Fixture','Photographs/completion added after costing',$3,$4)",[boardId,{...board,completed:true,qcJob:{date:'2026-11-07',evidence:{id:randomUUID()}}},randomUUID(),owner]);
  assert.equal((await qcMaterialHandoff(db.pool,key))!.signature,source!.signature,'Photographic completion must not invalidate material costing');
  await repo.decision(owner,{id:saved.id,version:saved.version,decision:'Closed',notes:'Reviewed native QC source',requestKey:randomUUID()});
  for(const table of ['inventory_reports','stock_on_hand_entries'])assert.equal((await db.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM accounts_job_pt_entries')).rows[0].n,1,'The existing PT entry was not duplicated');
 }finally{await db.close();}
});
