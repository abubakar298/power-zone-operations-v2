import {temporaryNegativeDoBalanceAllowed,negativeDoWindowStartsAt,negativeDoWindowEndsAt} from '../server/inventory/do-negative-balance.js';
import {UnsignedDoRepository} from '../server/inventory/unsigned-do.js';
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

test('owner-authorized negative DO balances work at preparation, unsigned edit and signed posting without inventing stock or replaying OUT',async(t)=>{
 t.mock.method(Date,'now',()=>Date.parse(negativeDoWindowStartsAt)+1000);
 const db=await (process.env.TEST_DIRECT_PGLITE==='true'?directMaterialDatabase():testDatabase());try{
  const f=await materialStockFixture(db.pool,'CH-CBL-AC-16MM/4C-PK',{canonicalIds:3},[{itemId:'CH-BAT-HV-05 KW',warehouse:'Lahore warehouse',unit:'Nos',description:'HV battery',opening:10,in:0,out:0,closing:10,openingStatus:'Reviewed source',review:''},{itemId:'CH-VPD-63A/2P',warehouse:'Lahore warehouse',unit:'piece',description:'VPD',opening:10,in:0,out:0,closing:10,openingStatus:'Reviewed source',review:''}]),coord=randomUUID(),opsUser=randomUUID(),keeper=randomUUID();
  for(const [id,role] of [[coord,'Coordinator'],[opsUser,'Operations'],[keeper,'Inventory']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@saved-issue.example.test',role,role,'isolated']);
  const fixedId='CH-BAT-HV-05 KW';
  await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$3),($2,'Lahore warehouse','storekeeper',$3)",[f.reviewer,keeper,f.owner]);
  const samples=await createDashboardSamples(db.pool,coord,f.owner),source=await approvedMaterialIpo(db.pool,coord,f.owner,samples.find((r:any)=>r.ipoId)!.ipoId),ops=new OperationsRepository(db.pool);
  const issuance=await ops.issue(coord,{ipoId:source.ipoId,notes:'Disposable saved issuance test',requestKey:randomUUID()}),delivery=await ops.planDelivery(opsUser,issuance.id,{version:0,requestKey:randomUUID(),details:{deliveryAddress:'Test site',siteContact:'Test',sitePhone:'0300',deliveryDate:'2026-10-29',deliveryTime:'',instructions:''}});
  await ops.sendToStore(opsUser,issuance.id,delivery.id,randomUUID());await new SiteWorkflowRepository(db.pool).list(opsUser);await db.pool.query("UPDATE site_workflow SET scope='installation' WHERE issuance_id=$1",[issuance.id]);await materialInstallationFixture(db.pool,source.ipoId,f.owner);
  const drafts=new MaterialDraftRepository(db.pool),plans=new SiteMaterialPlanRepository(db.pool),stock=new MaterialStockRepository(db.pool),basis=(await drafts.intake(f.reviewer)).sources.find(s=>s.siteId===source.ipoId)!;
  const saved=await plans.save(f.reviewer,{version:0,requestKey:randomUUID(),source:{sourceKind:basis.sourceKind,basisId:basis.basisId,basisVersion:1,siteId:basis.siteId},warehouse:'Lahore warehouse',transport:{issuedTo:'Test custodian',vehicle:'TEST',driver:'Test driver',driverIdentity:''},fixedLines:[{key:randomUUID(),itemId:fixedId,description:'HV battery',unit:'Nos',out:'1',sites:[basis.siteId],fixedGroup:'bess'},{key:randomUUID(),itemId:'CH-VPD-63A/2P',description:'VPD',unit:'piece',out:'',sites:[basis.siteId],fixedGroup:'other'}],variableLines:[{key:randomUUID(),itemId:'CH-CBL-AC-16MM/4C-PK',description:'Cable',unit:'m',out:'2',sites:[basis.siteId],section:'customer'}],variableSupply:'single-site'});
  await new WarehouseAuthorityRepository(db.pool).command(f.owner,{warehouse:'Lahore warehouse',version:0,sourceSha256:f.stockSha,state:'active',reason:'Verified isolated baseline',requestKey:randomUUID()});
  const command={version:saved.version,requestKey:randomUUID(),partialDelivery:true,note:'Entered quantities from saved preparation'};
  await assert.rejects(plans.issueSaved(keeper,saved.id,command,stock),/not assigned/);
  await assert.rejects(plans.issueSaved(f.reviewer,saved.id,{...command,partialDelivery:false},stock),/Partial delivery/);
  await assert.rejects(plans.issueSaved(f.reviewer,saved.id,{...command,quantities:{cable:'999'}},stock));
  const result=await plans.issueSaved(f.reviewer,saved.id,command,stock),record=await stock.dispatch(f.reviewer,result.id);


  const repo=new UnsignedDoRepository(db.pool),before=(await warehousePosition(db.pool,f.stockSha,f.key))?.currentClosing;
  const rows=record.snapshot.lines.map((r:any)=>({key:r.key,itemId:r.itemId,unit:r.unit,out:r.itemId==='CH-CBL-AC-16MM/4C-PK'?'12':r.out}));
  await repo.change(f.reviewer,result.id,{revision:1,requestKey:randomUUID(),action:'edit',reason:'Owner permits temporary negative DO balance while IGP entries are pending',lines:rows,transport:record.snapshot.transport});
  assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))?.currentClosing,before,'Saving and printing never deducts stock.');
  const gates=new GatePassRepository(db.pool),evidence=await stock.uploadEvidence(keeper,{warehouse:'Lahore warehouse',filename:'signed-negative-test.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7 FICTIONAL NEGATIVE DISPATCH').toString('base64')}),copy={kind:'dispatch' as const,documentId:result.id,documentRevision:2,copyKind:'signed-gate' as const,evidenceId:evidence.id,note:'Actual signed gate copy for isolated test',requestKey:randomUUID()};
  const posted=await gates.attach(keeper,copy);assert.equal(posted.stockPosted,true);assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))?.currentClosing,'-5');
  await gates.attach(keeper,copy);assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))?.currentClosing,'-5','Replay never duplicates OUT.');
  // A new saved DO must also be creatable against an already negative closing.
  const current=await plans.detail(f.reviewer,saved.id),basisSource=current.fixed.snapshot.sites[0];
  const next=await plans.save(f.reviewer,{id:saved.id,version:current.version,requestKey:randomUUID(),revisionReason:'Additional actual cable dispatch',source:{sourceKind:basisSource.sourceKind,basisId:basisSource.basisId,basisVersion:basisSource.basisVersion,siteId:basisSource.siteId},warehouse:'Lahore warehouse',transport:record.snapshot.transport,fixedLines:current.fixed.snapshot.lines,variableLines:current.variable!.snapshot.lines.map((r:any)=>({...r,out:'13'})),variableSupply:'single-site'});
  const more=await plans.issueSaved(f.reviewer,saved.id,{version:next.version,requestKey:randomUUID(),partialDelivery:true,note:'Owner-authorized additional actual cable'},stock);
  assert.equal(more.stockPosted,false);assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))?.currentClosing,'-5');
  await signDispatch(db.pool,keeper,'dispatch',more.id);assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))?.currentClosing,'-6');
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM inventory_warehouse_operational_movements WHERE ledger_key=$1 AND kind='dispatch-out'",[f.key])).rows[0].n,2);
 }finally{await db.close();}
});

test('negative DO exception lasts exactly ten days and automatically closes at the approved deadline',()=>{const start=Date.parse(negativeDoWindowStartsAt),end=Date.parse(negativeDoWindowEndsAt);assert.equal(end-start,10*24*60*60*1000);assert.equal(temporaryNegativeDoBalanceAllowed(start-1),false);assert.equal(temporaryNegativeDoBalanceAllowed(start),true);assert.equal(temporaryNegativeDoBalanceAllowed(end-1),true);assert.equal(temporaryNegativeDoBalanceAllowed(end),false);});
