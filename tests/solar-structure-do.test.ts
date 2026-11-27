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
import {UnsignedDoRepository} from '../server/inventory/unsigned-do.js';
import {WarehouseAuthorityRepository} from '../server/inventory/warehouse-ledger.js';
import {GatePassRepository} from '../server/inventory/gate-passes.js';
import {issuedDispatchPrintModel} from '../server/inventory/material-document-model.js';

/** An installation site with an approved IPO, a dispatcher and an active warehouse balance. */
async function siteWithStock(db:{pool:import('pg').Pool}){
 const f=await materialStockFixture(db.pool,'CH-CBL-AC-16MM/4C-PK',{canonicalIds:3},[{itemId:'CH-BAT-HV-05 KW',warehouse:'Lahore warehouse',unit:'Nos',description:'HV battery',opening:10,in:0,out:0,closing:10,openingStatus:'Reviewed source',review:''},{itemId:'CH-VPD-63A/2P',warehouse:'Lahore warehouse',unit:'piece',description:'VPD',opening:10,in:0,out:0,closing:10,openingStatus:'Reviewed source',review:''}]),coord=randomUUID(),opsUser=randomUUID(),keeper=randomUUID();
 for(const [id,role] of [[coord,'Coordinator'],[opsUser,'Operations'],[keeper,'Inventory']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@solar-structure.example.test',role,role,'isolated']);
 await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$3),($2,'Lahore warehouse','storekeeper',$3)",[f.reviewer,keeper,f.owner]);
 const samples=await createDashboardSamples(db.pool,coord,f.owner),source=await approvedMaterialIpo(db.pool,coord,f.owner,samples.find((r:any)=>r.ipoId)!.ipoId),ops=new OperationsRepository(db.pool);
 const issuance=await ops.issue(coord,{ipoId:source.ipoId,notes:'Disposable solar structure test',requestKey:randomUUID()}),delivery=await ops.planDelivery(opsUser,issuance.id,{version:0,requestKey:randomUUID(),details:{deliveryAddress:'Test site',siteContact:'Test',sitePhone:'0300',deliveryDate:'2026-10-29',deliveryTime:'',instructions:''}});
 await ops.sendToStore(opsUser,issuance.id,delivery.id,randomUUID());await new SiteWorkflowRepository(db.pool).list(opsUser);await db.pool.query("UPDATE site_workflow SET scope='installation' WHERE issuance_id=$1",[issuance.id]);await materialInstallationFixture(db.pool,source.ipoId,f.owner);
 const drafts=new MaterialDraftRepository(db.pool),plans=new SiteMaterialPlanRepository(db.pool),stock=new MaterialStockRepository(db.pool),basis=(await drafts.intake(f.reviewer)).sources.find(s=>s.siteId===source.ipoId)!;
 const site={sourceKind:basis.sourceKind,basisId:basis.basisId,basisVersion:1 as const,siteId:basis.siteId},transport={issuedTo:'Test custodian',vehicle:'TEST',driver:'Test driver',driverIdentity:''};
 const structureKey=randomUUID(),structure={key:structureKey,itemId:'CH-Solar Structure',description:'Solar structure — 3 kW',unit:'No.',out:'1',sites:[basis.siteId],fixedGroup:'panels' as const};
 const fixedLines=[{key:randomUUID(),itemId:'CH-BAT-HV-05 KW',description:'HV battery',unit:'Nos',out:'1',sites:[basis.siteId],fixedGroup:'bess' as const},structure,{key:randomUUID(),itemId:'CH-VPD-63A/2P',description:'VPD',unit:'piece',out:'',sites:[basis.siteId],fixedGroup:'other' as const}];
 const variableLines=[{key:randomUUID(),itemId:'CH-CBL-AC-16MM/4C-PK',description:'Cable',unit:'m',out:'2',sites:[basis.siteId],section:'customer' as const}];
 const plan=(lines:typeof fixedLines)=>({version:0,requestKey:randomUUID(),source:site,warehouse:'Lahore warehouse',transport,fixedLines:lines,variableLines,variableSupply:'single-site' as const});
 await new WarehouseAuthorityRepository(db.pool).command(f.owner,{warehouse:'Lahore warehouse',version:0,sourceSha256:f.stockSha,state:'active',reason:'Verified isolated baseline',requestKey:randomUUID()});
 return {f,keeper,plans,stock,site,transport,structureKey,fixedLines,plan};
}
// Owner instruction 23 Nov 2026: the solar structure is bought from a vendor, so it is
// listed on the DO (quantity 1, chosen kW) without any warehouse stock movement.
test('CH-Solar Structure goes on the DO with its kW and never touches warehouse stock',async()=>{
 const db=await (process.env.TEST_DIRECT_PGLITE==='true'?directMaterialDatabase():testDatabase());try{
  const {f,keeper,plans,stock,site,transport,structureKey,fixedLines,plan}=await siteWithStock(db);

  // No kW chosen, a quantity other than 1, or another unit: refused with a plain reason.
  for(const wrong of [{description:'Solar structure'},{out:'2'},{unit:'Nos'}])
   await assert.rejects(plans.save(f.reviewer,plan(fixedLines.map(r=>r.key===structureKey?{...r,...wrong}:r))),/Solar structure needs its kW size/);

  const saved=await plans.save(f.reviewer,plan(fixedLines));
  const first=await plans.issueSaved(f.reviewer,saved.id,{version:saved.version,requestKey:randomUUID(),partialDelivery:true,note:'First partial delivery'},stock);
  const record=await stock.dispatch(f.reviewer,first.id);
  assert.deepEqual(record.snapshot.lines.map((r:any)=>[r.itemId,r.out,r.description]).sort(),[['CH-BAT-HV-05 KW','1','HV battery'],['CH-CBL-AC-16MM/4C-PK','2','Cable'],['CH-Solar Structure','1','Solar structure — 3 kW']],'The DO lists the structure with its kW.');
  const printed=issuedDispatchPrintModel(record);
  assert.deepEqual(printed.rows.filter((r:any)=>r.itemId==='CH-Solar Structure').map((r:any)=>[r.description,r.issued,r.unit]),[['Solar structure — 3 kW','1','No.']],'Every DO copy, PDF and print shows the kW.');

  const stockLines=async(id:string)=>(await db.pool.query('SELECT item_id FROM inventory_material_dispatch_lines WHERE dispatch_id=$1 ORDER BY item_id',[id])).rows.map(r=>r.item_id);
  const pendingItems=async(id:string)=>((await db.pool.query("SELECT movements FROM inventory_signed_dispatch_pending WHERE document_kind='dispatch' AND document_id=$1",[id])).rows[0].movements as {ledgerKey:string}[]).map(m=>m.ledgerKey);
  assert.deepEqual(await stockLines(first.id),['CH-BAT-HV-05 KW','CH-CBL-AC-16MM/4C-PK'],'No warehouse stock line for the structure.');
  assert.equal((await pendingItems(first.id)).some(key=>/solar structure/i.test(key)),false,'The signed copy will not post a structure OUT.');

  // Editing the unsigned DO keeps the structure as it is; its quantity cannot change.
  const repo=new UnsignedDoRepository(db.pool),rows=record.snapshot.lines.map((r:any)=>({key:r.key,itemId:r.itemId,unit:r.unit,out:r.out}));
  const edit={revision:1,requestKey:randomUUID(),action:'edit' as const,reason:'Correct the vehicle before dispatch',transport:{...record.snapshot.transport,vehicle:'TEST-EDITED'},lines:rows};
  await assert.rejects(repo.change(f.reviewer,first.id,{...edit,lines:rows.map((r:any)=>r.itemId==='CH-Solar Structure'?{...r,out:'2'}:r)}),/always 1/);
  assert.equal((await repo.change(f.reviewer,first.id,edit)).revision,2);
  const edited=await stock.dispatch(f.reviewer,first.id);
  assert.deepEqual(edited.snapshot.lines.find((r:any)=>r.itemId==='CH-Solar Structure')?.description,'Solar structure — 3 kW');
  assert.deepEqual(await stockLines(first.id),['CH-BAT-HV-05 KW','CH-CBL-AC-16MM/4C-PK']);
  assert.equal((await plans.detail(f.reviewer,saved.id)).fixed.snapshot.lines.find((r:any)=>r.key===structureKey)?.out,'1','The site preparation still holds the structure.');

  // A later partial delivery does not send the structure again.
  const current=await plans.detail(f.reviewer,saved.id);
  const next=await plans.save(f.reviewer,{id:saved.id,version:current.version,requestKey:randomUUID(),revisionReason:'Second partial delivery',source:site,warehouse:'Lahore warehouse',transport,fixedLines:current.fixed.snapshot.lines.map((r:any)=>r.itemId==='CH-VPD-63A/2P'?{...r,out:'3'}:r),variableLines:current.variable!.snapshot.lines,variableSupply:'single-site'});
  const second=await plans.issueSaved(f.reviewer,saved.id,{version:next.version,requestKey:randomUUID(),partialDelivery:true,note:'Second partial delivery'},stock);
  assert.deepEqual((await stock.dispatch(f.reviewer,second.id)).snapshot.lines.map((r:any)=>[r.itemId,r.out]),[['CH-VPD-63A/2P','3']]);

  // The signed gate copy posts warehouse OUT for stock items only.
  const evidence=await stock.uploadEvidence(keeper,{warehouse:'Lahore warehouse',filename:'FICTIONAL-signed-gate.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7 FICTIONAL SIGNED GATE').toString('base64')});
  await new GatePassRepository(db.pool).attach(keeper,{kind:'dispatch',documentId:first.id,documentRevision:2,copyKind:'signed-gate',evidenceId:evidence.id,note:'Fictional signed gate copy for isolated test',requestKey:randomUUID()});
  const posted=(await db.pool.query("SELECT ledger_key FROM inventory_warehouse_operational_movements WHERE dispatch_id=$1 AND kind='dispatch-out'",[first.id])).rows.map(r=>r.ledger_key as string);
  assert.equal(posted.length,2);
  assert.equal(posted.some(key=>/solar structure/i.test(key)),false);
 }finally{await db.close();}
});

// Shaiggan's case (23 Nov 2026): a DO was saved without the structure; he adds it to that same DO with "Edit this DO".
test('Edit this DO adds CH-Solar Structure with its kW to the same DO, without warehouse stock',async()=>{
 const db=await (process.env.TEST_DIRECT_PGLITE==='true'?directMaterialDatabase():testDatabase());try{
  const {f,plans,stock,structureKey,fixedLines,plan}=await siteWithStock(db);
  const saved=await plans.save(f.reviewer,plan(fixedLines.filter(r=>r.key!==structureKey)));
  const issued=await plans.issueSaved(f.reviewer,saved.id,{version:saved.version,requestKey:randomUUID(),partialDelivery:true,note:'Delivery without the structure'},stock);
  const repo=new UnsignedDoRepository(db.pool),detail=await repo.detail(f.reviewer,issued.id);
  assert.deepEqual(detail.catalogue.find(i=>i.itemId==='CH-Solar Structure'),{itemId:'CH-Solar Structure',description:'Solar structure',units:['No.']},'Edit this DO offers the structure.');
  const record=await stock.dispatch(f.reviewer,issued.id),rows=record.snapshot.lines.map((r:any)=>({key:r.key,itemId:r.itemId,unit:r.unit,out:r.out})),key=randomUUID();
  const edit=(structure:Record<string,string>)=>({revision:1,requestKey:randomUUID(),action:'edit' as const,reason:'Add the solar structure to this DO',transport:record.snapshot.transport,lines:[...rows,{key,itemId:'CH-Solar Structure',unit:'No.',out:'1',...structure}]});
  await assert.rejects(repo.change(f.reviewer,issued.id,edit({})),/Solar structure needs its kW size/,'A kW size is required.');
  await assert.rejects(repo.change(f.reviewer,issued.id,edit({description:'Solar structure — 4 kW',out:'2'})),/always 1/);
  assert.equal((await repo.change(f.reviewer,issued.id,edit({description:'Solar structure — 4 kW'}))).revision,2);
  const after=await stock.dispatch(f.reviewer,issued.id);
  assert.equal(after.number,record.number,'Same DO number.');
  assert.deepEqual(after.snapshot.lines.find((r:any)=>r.itemId==='CH-Solar Structure'),{key,itemId:'CH-Solar Structure',unit:'No.',description:'Solar structure — 4 kW',out:'1',sites:record.snapshot.sites.map((s:any)=>s.siteId),fixedGroup:'panels'});
  assert.deepEqual(issuedDispatchPrintModel(after).rows.filter((r:any)=>r.itemId==='CH-Solar Structure').map((r:any)=>[r.description,r.issued]),[['Solar structure — 4 kW','1']],'The DO preview, print and PDF show it.');
  assert.deepEqual((await db.pool.query('SELECT item_id FROM inventory_material_dispatch_lines WHERE dispatch_id=$1 ORDER BY item_id',[issued.id])).rows.map(r=>r.item_id),['CH-BAT-HV-05 KW','CH-CBL-AC-16MM/4C-PK'],'Still no warehouse stock line for the structure.');
  assert.equal(JSON.stringify((await db.pool.query("SELECT movements FROM inventory_signed_dispatch_pending WHERE document_id=$1",[issued.id])).rows[0].movements).includes('Solar Structure'),false);
  const prepared=(await plans.detail(f.reviewer,saved.id)).fixed.snapshot.lines.find((r:any)=>r.key===key);
  assert.deepEqual([prepared?.description,prepared?.out],['Solar structure — 4 kW','1'],'The site preparation follows the edited DO.');
 }finally{await db.close();}
});
