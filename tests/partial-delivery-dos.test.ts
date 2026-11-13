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
import {issuedDispatchPrintModel} from '../server/inventory/material-document-model.js';

test('each partial delivery is its own DO; a later DO never changes an earlier one',async()=>{
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
  const issuedDo=async(id:string)=>{const d=await stock.dispatch(f.reviewer,id);return {number:d.number,lines:d.snapshot.lines.map((r:any)=>[r.itemId,r.out]).sort()};};
  // 1st partial delivery: 1 battery and 2 m cable.
  const first=await plans.issueSaved(f.reviewer,saved.id,{version:saved.version,requestKey:randomUUID(),partialDelivery:true,note:'First partial delivery'},stock);
  const firstBefore=await issuedDo(first.id);
  assert.deepEqual(firstBefore.lines,[['CH-BAT-HV-05 KW','1'],['CH-CBL-AC-16MM/4C-PK','2']]);
  const gatePending=(await db.pool.query("SELECT 1 FROM inventory_signed_dispatch_pending WHERE document_kind='dispatch' AND document_id=$1",[first.id])).rowCount;
  assert.equal(gatePending,1);
  const otherDispatcher=randomUUID();
  await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Other dispatcher','Inventory','isolated')",[otherDispatcher,otherDispatcher+'@saved-issue.example.test']);
  await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Karachi warehouse','dispatcher',$2)",[otherDispatcher,f.owner]);
  const upcoming=await drafts.intake(f.reviewer);
  assert.equal(upcoming.continuingProjects.find(s=>s.siteId===source.ipoId)?.planId,saved.id);
  assert.equal((await drafts.intake(otherDispatcher)).continuingProjects.some(s=>s.siteId===source.ipoId),false);

  // Two days later (first DO still unsigned): the remaining fixed item goes out.
  const current=await plans.detail(f.reviewer,saved.id),site=current.fixed.snapshot.sites[0];
  const more=(lines:any[],add:Record<string,string>)=>lines.map((r:any)=>add[r.itemId]?{...r,out:String(Number(r.out||0)+Number(add[r.itemId]))}:r);
  const next=await plans.save(f.reviewer,{id:saved.id,version:current.version,requestKey:randomUUID(),revisionReason:'Second partial delivery',source:{sourceKind:site.sourceKind,basisId:site.basisId,basisVersion:site.basisVersion,siteId:site.siteId},warehouse:'Lahore warehouse',transport:{issuedTo:'Second custodian',vehicle:'TEST-2',driver:'Second driver',driverIdentity:''},fixedLines:more(current.fixed.snapshot.lines,{'CH-VPD-63A/2P':'3'}),variableLines:more(current.variable!.snapshot.lines,{'CH-CBL-AC-16MM/4C-PK':'4'}),variableSupply:'single-site'});
  const second=await plans.issueSaved(f.reviewer,saved.id,{version:next.version,requestKey:randomUUID(),partialDelivery:true,note:'Second partial delivery'},stock);
  assert.notEqual(second.id,first.id);
  const secondDo=await issuedDo(second.id),firstAfter=await issuedDo(first.id);
  assert.notEqual(secondDo.number,firstBefore.number,'The second delivery has its own DO number.');
  assert.deepEqual(secondDo.lines,[['CH-CBL-AC-16MM/4C-PK','4'],['CH-VPD-63A/2P','3']],'The second DO holds only what was sent now.');
  assert.deepEqual(firstAfter,firstBefore,'The first DO keeps exactly its own items.');
  const listed=(await plans.issued(f.reviewer,saved.id)).dispatches.map(d=>d.number).sort();
  assert.deepEqual(listed,[firstBefore.number,secondDo.number].sort(),'Both DOs stay listed with the project.');
  // Signing the first leaves every DO as it was.
  await signDispatch(db.pool,keeper,'dispatch',first.id);
  assert.deepEqual(await issuedDo(first.id),firstBefore);assert.deepEqual(await issuedDo(second.id),secondDo);
  // The customer needs 3 m more cable: an Additional DO for extra material, with the project's other DOs.
  const latest=await plans.detail(f.reviewer,saved.id),latestSite=latest.fixed.snapshot.sites[0];
  const extra=await plans.save(f.reviewer,{id:saved.id,version:latest.version,requestKey:randomUUID(),revisionReason:'Customer needs 3 m more cable',source:{sourceKind:latestSite.sourceKind,basisId:latestSite.basisId,basisVersion:latestSite.basisVersion,siteId:latestSite.siteId},warehouse:'Lahore warehouse',transport:latest.fixed.snapshot.transport,fixedLines:latest.fixed.snapshot.lines,variableLines:more(latest.variable!.snapshot.lines,{'CH-CBL-AC-16MM/4C-PK':'3'}),variableSupply:'single-site'});
  const additional=await plans.issueSaved(f.reviewer,saved.id,{version:extra.version,requestKey:randomUUID(),partialDelivery:false,additional:true,note:'Customer needs 3 m more cable'},stock);
  const additionalRecord=await stock.dispatch(f.reviewer,additional.id),additionalDo=await issuedDo(additional.id);
  assert.deepEqual(additionalDo.lines,[['CH-CBL-AC-16MM/4C-PK','3']],'The Additional DO holds only the extra material.');
  assert.equal(additionalRecord.snapshot.additional,true);

  assert.match(issuedDispatchPrintModel(additionalRecord).title,/Additional/);
  assert.doesNotMatch(issuedDispatchPrintModel(await stock.dispatch(f.reviewer,second.id)).title,/Additional/);
  assert.deepEqual(await issuedDo(first.id),firstBefore);assert.deepEqual(await issuedDo(second.id),secondDo);
  const kinds=(await plans.issued(f.reviewer,saved.id)).dispatches.map(d=>[d.number,d.additional]).sort();
  assert.deepEqual(kinds,[[firstBefore.number,false],[secondDo.number,false],[additionalDo.number,true]].sort(),'All three DOs stay with the project; only the last is Additional.');

  const printed=issuedDispatchPrintModel(await stock.dispatch(f.reviewer,first.id));assert.deepEqual(printed.rows.map((r:any)=>[r.itemId,r.issued]).sort(),firstBefore.lines);
  await db.pool.query('INSERT INTO inventory_retrospective_dispatches(dispatch_id,dispatch_number,warehouse,reason,authority) VALUES($1,$2,$3,$4,$5)',[second.id,secondDo.number,'Lahore warehouse','Isolated retrospective test','Test owner']);
  const signed=await signDispatch(db.pool,keeper,'dispatch',second.id);
  assert.equal(signed.stockPosted,false);
  const gates=new GatePassRepository(db.pool);
  const gate=(await gates.detail(f.owner,'dispatch',second.id)).copies[0];
  const reviewReason='Verified the original warehouse ledger and signed gate copy.';
  await assert.rejects(gates.postRetrospectiveOut(keeper,second.id,gate.evidence_id,reviewReason),/Management must confirm/);
  await assert.rejects(gates.postRetrospectiveOut(f.owner,second.id,randomUUID(),reviewReason),/saved signed gate copy/);
  assert.equal((await gates.list(f.owner)).records.find(r=>r.id===second.id)?.retrospective_out_pending,true);
  assert.deepEqual(await gates.postRetrospectiveOut(f.owner,second.id,gate.evidence_id,reviewReason),{stockPosted:true});
  assert.deepEqual(await gates.postRetrospectiveOut(f.owner,second.id,gate.evidence_id,reviewReason),{stockPosted:false});
  assert.equal((await gates.list(f.owner)).records.find(r=>r.id===second.id)?.retrospective_out_pending,false);
  assert.deepEqual((await db.pool.query("SELECT out_delta::float AS quantity FROM inventory_warehouse_operational_movements WHERE dispatch_id=$1 AND kind='dispatch-out' ORDER BY out_delta",[second.id])).rows,[{quantity:3},{quantity:4}]);
 }finally{await db.close();}
});
