import {approvedMaterialIpo,materialInstallationFixture,materialBoardFixture} from './approved-material-ipo-fixture.js';
import {MaterialUsageRepository} from '../server/inventory/material-usage.js';
import {MaterialStockRepository} from '../server/inventory/material-stock.js';
import {siteUsagePrintModel} from '../server/inventory/material-document-model.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import request from 'supertest';
import {testDatabase} from './database.js';
import {createDashboardSamples} from '../server/coordinator/samples.js';
import {OperationsRepository} from '../server/operations/repository.js';
import {SiteWorkflowRepository} from '../server/site-workflow/repository.js';
import {MaterialDraftRepository} from '../server/inventory/material-drafts.js';
import {SiteMaterialPlanRepository} from '../server/inventory/site-material-plans.js';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import {digest} from '../server/auth/crypto.js';
import {approvedEarthingBasis} from '../shared/material-preparation.js';

test('site preparation atomically retains fixed and variable modules, Parent DO intent, versions and permissions without issuing stock',async()=>{
 const db=await testDatabase();try{
  const users:Record<string,string>={};
  for(const [name,role] of Object.entries({owner:'Admin',coordinator:'Coordinator',operations:'Operations',inventory:'Inventory',storekeeper:'Inventory'})){
   users[name]=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[users[name],name+'@site-plan.example.test',name,role,'isolated']);
  }
  for(const [name,capability] of [['inventory','dispatcher'],['storekeeper','storekeeper']])await db.pool.query('INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,$2,$3,$4)',[users[name],'Lahore warehouse',capability,users.owner]);
  const samples=await createDashboardSamples(db.pool,users.coordinator,users.owner),sample=await approvedMaterialIpo(db.pool,users.coordinator,users.owner,samples.find((s:any)=>s.ipoId)!.ipoId);
  const ops=new OperationsRepository(db.pool),issued=await ops.issue(users.coordinator,{ipoId:sample.ipoId,notes:'Disposable site material preparation',requestKey:randomUUID()});
  const delivery=await ops.planDelivery(users.operations,issued.id,{version:0,requestKey:randomUUID(),details:{deliveryAddress:'Test site',siteContact:'Test person',sitePhone:'0300',deliveryDate:'2026-10-27',deliveryTime:'10:00',instructions:''}});
  const handoff=await ops.sendToStore(users.operations,issued.id,delivery.id,randomUUID());
  await new SiteWorkflowRepository(db.pool).list(users.operations);
  await db.pool.query("UPDATE site_workflow SET scope='installation' WHERE issuance_id=$1",[issued.id]);await materialInstallationFixture(db.pool,sample.ipoId,users.owner);
  const drafts=new MaterialDraftRepository(db.pool),repo=new SiteMaterialPlanRepository(db.pool);
  const ready=(await drafts.intake(users.inventory)).sources.find(row=>row.siteId===sample.ipoId)!;assert.ok(ready);assert.equal(ready.sourceKind,'linked-ipo');
  const source={sourceKind:ready.sourceKind,basisId:ready.basisId,basisVersion:1 as const,siteId:sample.ipoId};
  const input={version:0,requestKey:randomUUID(),source,warehouse:'Lahore warehouse',transport:{issuedTo:'Test engineer',vehicle:'',driver:'',driverIdentity:''},fixedLines:[],variableLines:[],variableSupply:'parent-do' as const};
  const stockBefore=(await db.pool.query('SELECT count(*)::int n FROM stock_on_hand_entries')).rows[0].n;
  const approved=(await drafts.intake(users.inventory)).sources[0];
  const boreIndex=approved.items.findIndex(approvedEarthingBasis);
  assert.ok(boreIndex>=0,'The approved fixture must exercise the locked earthing row.');
  if(boreIndex>=0){
   const basis=approved.items[boreIndex] as any;
   const locked={key:randomUUID(),itemId:'CH-Earthing',description:basis.description,unit:basis.unit,out:String(basis.qty),sites:[sample.ipoId],fixedGroup:'panels' as const,basisLine:boreIndex};
   const savedBore=await repo.save(users.inventory,{...input,requestKey:randomUUID(),fixedLines:[locked]});
   const borePlan=await repo.detail(users.inventory,savedBore.id),usage=new MaterialUsageRepository(db.pool);
   const evidence=await new MaterialStockRepository(db.pool).uploadEvidence(users.inventory,{warehouse:input.warehouse,filename:'fictional-approved-earthing-work.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7 FICTIONAL APPROVED WORK').toString('base64')});
   const report={draftId:borePlan.fixed.id,siteId:sample.ipoId,version:0,requestKey:randomUUID(),date:'2026-10-27',state:'signed' as const,reason:'Approved earthing work completed, not a stock dispatch.',customerEvidenceId:null,internalEvidenceId:evidence.id,lines:[{lineKey:locked.key,issued:locked.out,used:locked.out,returned:null}]};
   await assert.rejects(usage.save(users.inventory,{...report,lines:[{...report.lines[0],issued:'999'}]}),/quantity is locked/);
   await usage.save(users.inventory,report);const actual=await usage.site(users.inventory,borePlan.fixed.id,sample.ipoId),irr=siteUsagePrintModel(actual,'irr');assert.equal(irr.rows[0].itemId,'CH-Earthing');assert.equal(irr.rows[0].used,locked.out);assert.equal(irr.rows[0].returned,null);assert.match(irr.rows[0].remark??'',/not warehouse stock/);assert.deepEqual(irr.signatures,['Site engineer','QC verification']);
   assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_warehouse_operational_movements')).rows[0].n,0,'Approved non-stock work never creates warehouse OUT or IN.');

   await assert.rejects(repo.save(users.inventory,{...input,id:savedBore.id,version:1,requestKey:randomUUID(),fixedLines:[{...locked,itemId:''}]}),/approved BOQ identity/);
   await assert.rejects(repo.save(users.inventory,{...input,id:savedBore.id,version:1,requestKey:randomUUID(),fixedLines:[{...locked,out:'999'}]}),/approved BOQ identity/);
  }
  const saved=await repo.save(users.inventory,input);
  assert.equal(saved.version,1);assert.equal(saved.stockPosting,false);
  assert.deepEqual(await repo.save(users.inventory,input),saved);
  let detail=await repo.detail(users.inventory,saved.id);
  assert.equal(detail.variableSupply,'parent-do');assert.equal(detail.fixed.snapshot.kind,'fixed');assert.equal(detail.variable!.snapshot.kind,'variable');assert.equal(detail.variable!.snapshot.parent,false);
  assert.deepEqual(detail.variable!.snapshot.lines,[],'A Parent DO choice must never invent variable quantities.');
  await assert.rejects(drafts.save(users.inventory,{id:detail.fixed.id,version:1,requestKey:randomUUID(),kind:'fixed',parent:false,warehouse:input.warehouse,sites:[source],lines:[],transport:input.transport}),/both modules/);
  assert.equal((await repo.list(users.inventory)).plans.length,boreIndex>=0?2:1);
  await assert.rejects(repo.detail(users.storekeeper,saved.id),/not assigned/);
  await assert.rejects(repo.save(users.storekeeper,{...input,requestKey:randomUUID()}),/not assigned/);
  await assert.rejects(repo.save(users.inventory,{...input,requestKey:randomUUID(),warehouse:'Karachi warehouse'}),/warehouse/);
  await assert.rejects(repo.save(users.inventory,{...input,transport:{...input.transport,vehicle:'changed'}}),/different saved/);

  const cable={key:randomUUID(),itemId:'CH-CBL-ERT-10MM/1C-PK',description:'10mm earthing cable',unit:'m',out:'',sites:[sample.ipoId],section:'customer' as const};
  const changed=await repo.save(users.inventory,{...input,id:saved.id,version:1,requestKey:randomUUID(),variableSupply:'single-site',variableLines:[cable]});
  assert.equal(changed.version,2);detail=await repo.detail(users.inventory,saved.id);
  assert.equal(detail.variable!.snapshot.lines[0].key,cable.key);assert.equal(detail.variable!.snapshot.lines[0].out,'');
  assert.equal((await db.pool.query('SELECT variable_supply FROM inventory_site_material_plan_versions WHERE plan_id=$1 AND version=1',[saved.id])).rows[0].variable_supply,'parent-do','Changing the supply route must retain its history.');
  const beforeVersions=(await db.pool.query('SELECT count(*)::int n FROM inventory_material_draft_versions')).rows[0].n;
  await assert.rejects(repo.save(users.inventory,{...input,id:saved.id,version:2,requestKey:randomUUID(),variableLines:[{...cable,itemId:'UNKNOWN'}]}),/final stock ID/);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_material_draft_versions')).rows[0].n,beforeVersions,'A failed variable module must roll back the fixed module too.');
  assert.equal((await repo.detail(users.inventory,saved.id)).version,2);
  await assert.rejects(repo.save(users.inventory,{...input,id:saved.id,version:2,requestKey:randomUUID(),source:{...source,siteId:randomUUID()}}),/original approved site/);
  const concurrent=await Promise.allSettled([repo.save(users.inventory,{...input,id:saved.id,version:2,requestKey:randomUUID()}),repo.save(users.inventory,{...input,id:saved.id,version:2,requestKey:randomUUID()})]);
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await repo.detail(users.inventory,saved.id)).version,3);
  const parentDraft=await drafts.save(users.inventory,{version:0,requestKey:randomUUID(),kind:'variable',parent:true,warehouse:input.warehouse,sites:[source],lines:[cable],transport:input.transport});
  const otherWarehousePlan=await repo.save(users.owner,{...input,requestKey:randomUUID(),warehouse:'Karachi warehouse'});

  await db.pool.query("UPDATE site_workflow SET scope='delivery_only' WHERE issuance_id=$1",[issued.id]);
  await materialBoardFixture(db.pool,sample.ipoId,users.owner,{installation:false,scopePending:false,projectType:'delivery-only'});
  const noVariance=await repo.save(users.inventory,{...input,requestKey:randomUUID(),variableSupply:'single-site'});
  assert.equal((await repo.detail(users.inventory,noVariance.id)).variable,null);
  await assert.rejects(repo.save(users.inventory,{...input,requestKey:randomUUID()}),/Delivery-only/);
  await assert.rejects(db.pool.query('DELETE FROM inventory_site_material_plan_versions WHERE plan_id=$1',[saved.id]));
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM stock_on_hand_entries')).rows[0].n,stockBefore);

  const origin='http://localhost:3000',app=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:origin,DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'isolated-site-material-test-token'}));
  const sessions:Record<string,{cookie:string;csrf:string}>={};
  for(const name of ['inventory','storekeeper']){const token=randomBytes(32).toString('base64url'),csrf=randomUUID();await db.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),users[name],csrf]);sessions[name]={cookie:'pz_session='+token,csrf};}
  await request(app).get('/api/material-dispatches/site-plans').expect(401);
  await request(app).get('/api/material-dispatches/site-plans').set('Cookie',sessions.storekeeper.cookie).expect(403);
  await request(app).get('/api/material-dispatches/site-plans/'+saved.id).set('Cookie',sessions.inventory.cookie).expect(200);
  const prefix='/api/material-dispatches/site-plans/'+saved.id+'/documents/';
  await request(app).get(prefix+'fixed-do.pdf?version=3').expect(401);
  await request(app).get(prefix+'fixed-do.pdf?version=3').set('Cookie',sessions.storekeeper.cookie).expect(403);
  await request(app).get('/api/material-dispatches/site-plans/'+otherWarehousePlan.id+'/documents/fixed-do.pdf?version=1').set('Cookie',sessions.inventory.cookie).expect(403);
  const preview=await request(app).get(prefix+'fixed-do.pdf?version=3').set('Cookie',sessions.inventory.cookie).expect(200);
  assert.match(preview.headers['content-type'],/application\/pdf/);assert.match(preview.headers['cache-control'],/no-store/);
  await request(app).get(prefix+'fixed-do.pdf?version=1').set('Cookie',sessions.inventory.cookie).expect(409);
  await request(app).get(prefix+'fixed-do.pdf').set('Cookie',sessions.inventory.cookie).expect(422);
  await request(app).get(prefix+'variable-do.pdf?version=3').set('Cookie',sessions.inventory.cookie).expect(409);
  await request(app).get(prefix+'customer-signoff.pdf?version=3').set('Cookie',sessions.inventory.cookie).expect(200);
  const parentPrefix='/api/material-dispatches/drafts/'+parentDraft.id+'/documents/';
  await request(app).get(parentPrefix+'variable-do.pdf?version=1').set('Cookie',sessions.inventory.cookie).expect(200);
  await request(app).get(parentPrefix+'customer-signoff.pdf?version=1&site='+source.siteId).set('Cookie',sessions.inventory.cookie).expect(200);
  await request(app).get(parentPrefix+'irr.pdf?version=1&site='+randomUUID()).set('Cookie',sessions.inventory.cookie).expect(404);
  await request(app).get(parentPrefix+'fixed-do.pdf?version=1').set('Cookie',sessions.inventory.cookie).expect(422);
  await request(app).post('/api/material-dispatches/site-plans').set('Cookie',sessions.inventory.cookie).set('Origin',origin).send(input).expect(403);
  await request(app).post('/api/material-dispatches/site-plans').set('Cookie',sessions.inventory.cookie).set('Origin',origin).set('X-CSRF-Token',sessions.inventory.csrf).send({...input,stockPosting:true}).expect(422);
  await db.pool.query("UPDATE site_workflow SET delivered_on='2026-10-27' WHERE issuance_id=$1",[issued.id]);
  await materialBoardFixture(db.pool,sample.ipoId,users.owner,{stage:'delivered',deliveryDate:'2026-10-27'});
  await assert.rejects(repo.save(users.inventory,{...input,requestKey:randomUUID(),variableSupply:'single-site'}),/no longer pending/);
  // Read access retains the saved preparation even when delivery removes it
  // from pending intake; it must not vanish or become a fresh stock movement.
  assert.equal((await repo.detail(users.inventory,noVariance.id)).version,1);
  await db.pool.query('UPDATE users SET active=false WHERE id=$1',[users.inventory]);
  await assert.rejects(repo.detail(users.inventory,saved.id),/access has ended/);
 }finally{await db.close();}
});
