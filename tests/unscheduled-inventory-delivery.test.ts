import {readWorkflowSite} from './operations-snapshot.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import {materialBoardFixture} from './approved-material-ipo-fixture.js';
import {MaterialUsageRepository} from '../server/inventory/material-usage.js';
import {GatePassRepository} from '../server/inventory/gate-passes.js';
import {directMaterialDatabase} from './direct-material-database.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {materialStockFixture} from './material-stock-fixture.js';
import {approvedMaterialIpo,materialInstallationFixture} from './approved-material-ipo-fixture.js';
import {createDashboardSamples} from '../server/coordinator/samples.js';
import {OperationsRepository} from '../server/operations/repository.js';
import {SiteWorkflowRepository} from '../server/site-workflow/repository.js';
import {MaterialDraftRepository} from '../server/inventory/material-drafts.js';
import {SiteMaterialPlanRepository} from '../server/inventory/site-material-plans.js';
import {MaterialStockRepository} from '../server/inventory/material-stock.js';
import {WarehouseAuthorityRepository,warehousePosition} from '../server/inventory/warehouse-ledger.js';
import {signDispatch} from './signed-dispatch-fixture.js';

test('unscheduled IPO issuance is allowed; customer receiving projects delivered installation-only and downloads only within the exact Operations region',async()=>{
 const db=await (process.env.TEST_DIRECT_PGLITE==='true'?directMaterialDatabase():testDatabase());try{
  const f=await materialStockFixture(db.pool,'CH-CBL-AC-16MM/4C-PK',{canonicalIds:2},[{itemId:'CH-BAT-HV-05 KW',warehouse:'Lahore warehouse',unit:'Nos',description:'HV battery',opening:10,in:0,out:0,closing:10,openingStatus:'Reviewed source',review:''}]),coord=randomUUID(),opsUser=randomUUID(),keeper=randomUUID();
  for(const [id,role] of [[coord,'Coordinator'],[opsUser,'Operations'],[keeper,'Inventory']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@saved-issue.example.test',role,role,'isolated']);
  const fixedId='CH-BAT-HV-05 KW';
  await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$3),($2,'Lahore warehouse','storekeeper',$3)",[f.reviewer,keeper,f.owner]);
  const samples=await createDashboardSamples(db.pool,coord,f.owner),source=await approvedMaterialIpo(db.pool,coord,f.owner,samples.find((r:any)=>r.ipoId)!.ipoId),ops=new OperationsRepository(db.pool);
  const issuance=await ops.issue(coord,{ipoId:source.ipoId,notes:'Disposable saved issuance test',requestKey:randomUUID()}),delivery=await ops.planDelivery(opsUser,issuance.id,{version:0,requestKey:randomUUID(),details:{deliveryAddress:'Test site',siteContact:'Test',sitePhone:'0300',deliveryDate:'2026-10-29',deliveryTime:'',instructions:''}});
  await ops.sendToStore(opsUser,issuance.id,delivery.id,randomUUID());await new SiteWorkflowRepository(db.pool).list(opsUser);await db.pool.query("UPDATE site_workflow SET scope='installation' WHERE issuance_id=$1",[issuance.id]);await materialInstallationFixture(db.pool,source.ipoId,f.owner);await materialBoardFixture(db.pool,source.ipoId,f.owner,{stage:'received',operationsTeam:'central',planningBatches:[],dispatchDate:undefined});
  const drafts=new MaterialDraftRepository(db.pool),plans=new SiteMaterialPlanRepository(db.pool),stock=new MaterialStockRepository(db.pool),basis=(await drafts.intake(f.reviewer)).sources.find(s=>s.siteId===source.ipoId)!;
  const saved=await plans.save(f.reviewer,{version:0,requestKey:randomUUID(),source:{sourceKind:basis.sourceKind,basisId:basis.basisId,basisVersion:1,siteId:basis.siteId},warehouse:'Lahore warehouse',transport:{issuedTo:'Test custodian',vehicle:'TEST',driver:'Test driver',driverIdentity:''},fixedLines:[{key:randomUUID(),itemId:fixedId,description:'HV battery',unit:'Nos',out:'1',sites:[basis.siteId],fixedGroup:'bess'}],variableLines:[{key:randomUUID(),itemId:'CH-CBL-AC-16MM/4C-PK',description:'Cable',unit:'m',out:'2',sites:[basis.siteId],section:'customer'}],variableSupply:'single-site'});
  await new WarehouseAuthorityRepository(db.pool).command(f.owner,{warehouse:'Lahore warehouse',version:0,sourceSha256:f.stockSha,state:'active',reason:'Verified isolated baseline',requestKey:randomUUID()});
  const command={version:saved.version,requestKey:randomUUID(),partialDelivery:true,note:'Entered quantities from saved preparation'};
  await assert.rejects(plans.issueSaved(keeper,saved.id,command,stock),/not assigned/);
  await assert.rejects(plans.issueSaved(f.reviewer,saved.id,{...command,partialDelivery:false},stock),/Partial delivery/);
  await assert.rejects(plans.issueSaved(f.reviewer,saved.id,{...command,quantities:{cable:'999'}},stock));
  const result=await plans.issueSaved(f.reviewer,saved.id,command,stock),record=await stock.dispatch(f.reviewer,result.id);

  assert.equal(basis.dispatchDate,null,'The actual current source is unscheduled.');
  const boardId='live-ipo:'+source.ipoId,board=new OperationsBoardRepository(db.pool);
  assert.equal((await readWorkflowSite(board,f.owner,boardId)).stage,'received');
  const evidence=await stock.uploadEvidence(keeper,{warehouse:'Lahore warehouse',filename:'fictional-received.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7 FICTIONAL CUSTOMER RECEIPT').toString('base64')});
  const gates=new GatePassRepository(db.pool);await signDispatch(db.pool,keeper,'dispatch',result.id);
  assert.equal((await readWorkflowSite(board,f.owner,boardId)).stage,'received','Gate copy is stock OUT, not proof of customer delivery.');
  // This issued fixture is a partial trip; it must not claim full delivery.
  await gates.attach(keeper,{kind:'dispatch',documentId:result.id,copyKind:'signed-customer',evidenceId:evidence.id,note:'Actual partial customer receipt in isolated fixture',requestKey:randomUUID()});
  assert.equal((await readWorkflowSite(board,f.owner,boardId)).stage,'received');
  // Seed a full historical DO solely to exercise exact receiving lookup and scope.
  const original=(await db.pool.query('SELECT * FROM inventory_material_dispatches WHERE id=$1',[result.id])).rows[0],fullId=randomUUID();
  await db.pool.query('INSERT INTO inventory_material_dispatches(id,number,draft_id,draft_version,source_sha256,warehouse,snapshot,request_key,request_fingerprint,created_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[fullId,'SIMULATION-FULL-DO',original.draft_id,original.draft_version,original.source_sha256,original.warehouse,{...original.snapshot,partialDelivery:false},randomUUID(),'f'.repeat(64),f.reviewer]);
  const before=(await warehousePosition(db.pool,f.stockSha,f.key))?.currentClosing,rawBefore=(await db.pool.query('SELECT count(*)::int n FROM operations_board_versions WHERE site_id=$1',[boardId])).rows[0].n;
  await gates.attach(keeper,{kind:'dispatch',documentId:fullId,copyKind:'signed-gate',evidenceId:evidence.id,note:'Legacy full gate evidence, already governed by its original stock posting',requestKey:randomUUID()});
  await gates.attach(keeper,{kind:'dispatch',documentId:fullId,copyKind:'signed-customer',evidenceId:evidence.id,note:'Full historical customer receiving evidence for projection test',requestKey:randomUUID()});
  const delivered=await readWorkflowSite(board,f.owner,boardId);assert.equal(delivered.stage,'delivered');assert.equal(delivered.installation,true);assert.equal(delivered.completed,false);assert.equal(delivered.deliveryDate,undefined);assert.equal((await drafts.intake(f.reviewer)).sources.find(s=>s.siteId===basis.siteId)?.installationOnly,true,'A received site cannot dispatch its fixed equipment again without a new authorized delivery.');assert.equal((await board.sites(f.owner)).sites.find(s=>s.id===boardId)?.stage,'delivered');
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_board_versions WHERE site_id=$1',[boardId])).rows[0].n,rawBefore,'Projection cannot rewrite Operations or historical stage records.');
  assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))?.currentClosing,before,'Customer receiving and list reads never post stock again.');
  assert.match((await board.download(f.owner,boardId,evidence.id)).content.toString(),/FICTIONAL/);
  const wrongQc=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash)VALUES($1,$2,'Wrong regional QC','Operations','isolated')",[wrongQc,wrongQc+'@example.test']);await db.pool.query("INSERT INTO operations_board_access(user_id,kind,team,granted_by)VALUES($1,'qc','south',$2)",[wrongQc,f.owner]);await assert.rejects(board.download(wrongQc,boardId,evidence.id),/not found/);
 }finally{await db.close();}
});
