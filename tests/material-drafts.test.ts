import {variablePreparationRows} from '../shared/material-preparation.js';
import {approvedMaterialIpo,materialInstallationFixture} from './approved-material-ipo-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import request from 'supertest';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import {digest} from '../server/auth/crypto.js';
import {testDatabase} from './database.js';
import {createDashboardSamples} from '../server/coordinator/samples.js';
import {OperationsRepository} from '../server/operations/repository.js';
import {SiteWorkflowRepository} from '../server/site-workflow/repository.js';
import {MaterialDraftRepository} from '../server/inventory/material-drafts.js';

test('server-owned Parent DO drafts retain blank variable quantities and stable item rows, enforce approved source and warehouse scope, and never post stock',async()=>{
 const db=await testDatabase();try{
  const users:Record<string,string>={};
  for(const [name,role] of Object.entries({owner:'Admin',coordinator:'Coordinator',operations:'Operations',inventory:'Inventory',storekeeper:'Inventory'})){
   users[name]=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[users[name],name+'@example.test',name,role,'isolated']);
  }
  for(const [name,capability] of [['inventory','dispatcher'],['storekeeper','storekeeper']])await db.pool.query('INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,$2,$3,$4)',[users[name],'Lahore warehouse',capability,users.owner]);
  const samples=await createDashboardSamples(db.pool,users.coordinator,users.owner),source=await approvedMaterialIpo(db.pool,users.coordinator,users.owner,samples.find((r:any)=>r.ipoId)!.ipoId);
  const ops=new OperationsRepository(db.pool),issued=await ops.issue(users.coordinator,{ipoId:source.ipoId,notes:'Disposable material draft test',requestKey:randomUUID()});
  const plan=await ops.planDelivery(users.operations,issued.id,{version:0,requestKey:randomUUID(),details:{deliveryAddress:'Test site',siteContact:'Test lead',sitePhone:'0300',deliveryDate:'2026-10-27',deliveryTime:'10:00',instructions:''}});
  const handoff=await ops.sendToStore(users.operations,issued.id,plan.id,randomUUID());
  await new SiteWorkflowRepository(db.pool).list(users.operations);await db.pool.query("UPDATE site_workflow SET scope='installation' WHERE issuance_id=$1",[issued.id]);await materialInstallationFixture(db.pool,source.ipoId,users.owner);
  const board=(await db.pool.query('SELECT site_id,version,snapshot FROM operations_board_versions WHERE site_id=(SELECT board_site_id FROM inventory_material_source_links WHERE ipo_id=$1) ORDER BY version DESC LIMIT 1',[source.ipoId])).rows[0];
  await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,$2,$3,'SIMULATION planned dispatch','Exact planning date',$4,$5)",[board.site_id,board.version+1,{...board.snapshot,dispatchDate:'2026-11-02'},randomUUID(),users.owner]);
  const repo=new MaterialDraftRepository(db.pool),intake=await repo.intake(users.inventory);assert.equal(intake.sources.length,1);assert.equal(intake.sources[0].ipo,issued.snapshot.ipoNumber);assert.equal(intake.sources[0].authorization,'approved-ipo-boq');const basis=intake.sources[0];assert.equal(basis.sourceKind,'linked-ipo');assert.equal(basis.dispatchDate,'2026-11-02','Exact Operations plan is visible without changing source authority');
  // Positioning imported from Accounts/Operations is visible, but is not an
  // executable Store BOQ until a durable approved-basis link exists.
  for(const [id,stage,completed,sample] of [['registered-pending','received',false,false],['registered-completed','completed',true,false],['registered-sample','received',false,true]] as const){
   await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[id,users.owner]);
   await db.pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,$3,$4,$5,$6)',[id,{id,ipo:'REGISTERED-IPO',name:id,customer:'Test bank',stage,completed,sample,installation:true,dispatchDate:'2026-11-03'},'Source imported','isolated fixture',randomUUID(),users.owner]);
  }
  const registered=await repo.intake(users.inventory);assert.equal(registered.registeredPending.length,1);assert.equal(registered.registeredPending[0].siteId,'registered-pending');assert.equal(registered.registeredPending[0].dispatchDate,'2026-11-03');assert.equal(registered.sources.length,1,'Imported positioning must not fabricate approved source BOQs.');
  const stockBefore=(await db.pool.query('SELECT count(*)::int n FROM stock_on_hand_entries')).rows[0].n;
  const input={version:0,requestKey:randomUUID(),kind:'variable' as const,parent:true,warehouse:'Lahore warehouse',sites:[{sourceKind:basis.sourceKind,basisId:basis.basisId,basisVersion:1 as const,siteId:source.ipoId}],lines:variablePreparationRows([basis],intake.catalogue,()=>randomUUID(),intake.aliases??{}),transport:{issuedTo:'',vehicle:'',driver:'',driverIdentity:''}};
  const saved=await repo.save(users.inventory,input);assert.equal(saved.version,1);assert.equal(saved.stockPosting,false);assert.deepEqual(await repo.save(users.inventory,input),saved);
  const key=randomUUID(),row={key,itemId:'CH-CBL-AC-16MM/4C-PK',description:'16mm AC cable',unit:'m',out:'',sites:[source.ipoId]};
  const second=await repo.save(users.inventory,{...input,id:saved.id,version:1,requestKey:randomUUID(),lines:[row]});
  const third=await repo.save(users.inventory,{...input,id:saved.id,version:second.version,requestKey:randomUUID(),lines:[{...row,itemId:'CH-CBL-ERT-10MM/1C-PK',description:'10mm earthing cable'}]});
  const detail=await repo.detail(users.inventory,saved.id);assert.equal(detail.snapshot.lines[0].key,key);assert.equal(detail.snapshot.lines.length,1);assert.equal(detail.snapshot.lines[0].out,'');
  const historical=(await db.pool.query('SELECT snapshot FROM inventory_material_draft_versions WHERE draft_id=$1 AND version=2',[saved.id])).rows[0].snapshot;assert.equal(historical.lines[0].itemId,row.itemId);
  await assert.rejects(repo.save(users.inventory,{...input,id:saved.id,version:third.version,requestKey:randomUUID(),lines:[{...row,itemId:'UNKNOWN'}]}),/final stock ID/);
  await assert.rejects(repo.save(users.inventory,{...input,id:saved.id,version:third.version,requestKey:randomUUID(),lines:[{...row,unit:'coils'}]}),/recorded stock unit/);
  await assert.rejects(repo.save(users.inventory,{...input,id:saved.id,version:third.version,requestKey:randomUUID(),lines:[{...row,section:'internal'}]}),/matching variable-material module/);
  assert.equal((await repo.detail(users.inventory,saved.id)).version,3,'Rejected selection never removes the last saved row.');
  await assert.rejects(repo.save(users.inventory,{...input,requestKey:randomUUID(),warehouse:'Karachi warehouse'}),/warehouse/);
  const otherWarehouse=await repo.save(users.owner,{...input,requestKey:randomUUID(),warehouse:'Karachi warehouse'});await assert.rejects(repo.detail(users.inventory,otherWarehouse.id),/warehouse/);assert.equal((await repo.list(users.inventory)).drafts.length,1);
  await assert.rejects(repo.list(users.storekeeper),/not assigned/);await assert.rejects(repo.detail(users.storekeeper,saved.id),/not assigned/);
  await assert.rejects(repo.save(users.inventory,{...input,requestKey:randomUUID(),sites:[{...input.sites[0],siteId:randomUUID()}]}),/no longer pending/);
  const changes=await Promise.allSettled([repo.save(users.inventory,{...input,id:saved.id,version:3,requestKey:randomUUID(),lines:[row]}),repo.save(users.inventory,{...input,id:saved.id,version:3,requestKey:randomUUID(),lines:[row]})]);assert.equal(changes.filter(r=>r.status==='fulfilled').length,1);
  const mixed=(await repo.intake(users.owner)).catalogue.find(r=>r.itemId==='CH-Mix Items All')!;assert.ok(mixed);
  const current=await repo.detail(users.owner,otherWarehouse.id);
  const versioned=await repo.save(users.owner,{...input,warehouse:'Karachi warehouse',id:otherWarehouse.id,version:current.version,requestKey:randomUUID(),lines:[{...row,documentPolicyVersion:2,section:'internal',itemId:mixed.itemId,description:'Reviewed screws',unit:mixed.units[0]}]});
  assert.equal((await repo.detail(users.owner,otherWarehouse.id)).snapshot.lines[0].documentPolicyVersion,2);assert.equal(versioned.stockPosting,false);
  await db.pool.query("UPDATE site_workflow SET delivered_on='2026-10-27' WHERE issuance_id=$1",[issued.id]);
  const delivered=(await db.pool.query('SELECT version,snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',['live-ipo:'+source.ipoId])).rows[0];
  await db.pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',['live-ipo:'+source.ipoId,delivered.version+1,{...delivered.snapshot,stage:'delivered',deliveryDate:'2026-10-27'},'SIMULATION delivery fixture','Draft eligibility test; actual delivery evidence is tested separately.',randomUUID(),users.owner]);
  assert.equal((await repo.intake(users.inventory)).sources.length,0);
  await assert.rejects(repo.save(users.inventory,{...input,id:saved.id,version:4,requestKey:randomUUID()}),/no longer pending/);
  await assert.rejects(db.pool.query('DELETE FROM inventory_material_draft_versions WHERE draft_id=$1',[saved.id]));
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM stock_on_hand_entries')).rows[0].n,stockBefore);
  const origin='http://localhost:3000',app=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:origin,DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'material-draft-local-integration-token'}));
  const sessions:Record<string,{cookie:string;csrf:string}>={};
  for(const name of ['inventory','storekeeper']){const token=randomBytes(32).toString('base64url'),csrf=randomUUID();await db.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),users[name],csrf]);sessions[name]={cookie:'pz_session='+token,csrf};}
  await request(app).get('/api/material-dispatches/intake').expect(401);
  await request(app).get('/api/material-dispatches/drafts').set('Cookie',sessions.storekeeper.cookie).expect(403);
  const read=await request(app).get('/api/material-dispatches/drafts/'+saved.id).set('Cookie',sessions.inventory.cookie).expect(200);assert.match(read.headers['cache-control'],/no-store/);assert.equal(read.body.stockPosting,false);
  await request(app).get('/api/material-dispatches/drafts/'+otherWarehouse.id).set('Cookie',sessions.inventory.cookie).expect(403);
  await request(app).post('/api/material-dispatches/drafts').set('Cookie',sessions.inventory.cookie).set('Origin',origin).send(input).expect(403);
  await request(app).post('/api/material-dispatches/drafts').set('Cookie',sessions.inventory.cookie).set('Origin',origin).set('X-CSRF-Token',sessions.inventory.csrf).send({...input,stockPosting:true}).expect(422);
  await db.pool.query('UPDATE users SET active=false WHERE id=$1',[users.inventory]);await request(app).get('/api/material-dispatches/intake').set('Cookie',sessions.inventory.cookie).expect(401);
 }finally{await db.close();}
});

test('an existing legacy Store handoff keeps its original approved Store basis without a fabricated receiving link',async()=>{
 const db=await testDatabase();try{
  const owner=randomUUID(),coord=randomUUID();for(const [id,role]of [[owner,'Admin'],[coord,'Coordinator']])await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'SIMULATION legacy Store','test-only',$3)",[id,id+'@legacy.invalid',role]);
  const samples=await createDashboardSamples(db.pool,coord,owner),template=samples.find((s:any)=>s.ipoId)!,source=await approvedMaterialIpo(db.pool,coord,owner,template.ipoId),ops=new OperationsRepository(db.pool),snapshot=await ops.source(source.ipoId),issuance=randomUUID();
  // A saved pre-integration handoff, deliberately not a new issue command.
  await db.pool.query('INSERT INTO operations_boq_issuances(id,ipo_id,boq_revision_id,number,snapshot,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[issuance,source.ipoId,snapshot.boqRevisionId,'SIMULATION-LEGACY-HANDOFF',snapshot,randomUUID(),coord]);
  const delivery=await ops.planDelivery(owner,issuance,{version:0,requestKey:randomUUID(),details:{deliveryAddress:'SIMULATION legacy site',siteContact:'Test custodian',sitePhone:'0300',deliveryDate:'2026-10-28',deliveryTime:'10:00',instructions:''}}),store=await ops.sendToStore(owner,issuance,delivery.id,randomUUID());
  await new SiteWorkflowRepository(db.pool).ensure();await db.pool.query("UPDATE site_workflow SET scope='installation' WHERE issuance_id=$1",[issuance]);
  const repo=new MaterialDraftRepository(db.pool),basis=(await repo.intake(owner)).sources.find(s=>s.siteId===source.ipoId)!;assert.ok(basis);assert.equal(basis.sourceKind,'store-boq');assert.equal(basis.basisId,store.id);assert.equal(basis.authorization,'approved-store-boq');
  const saved=await repo.save(owner,{version:0,requestKey:randomUUID(),kind:'variable',parent:false,warehouse:'Lahore warehouse',sites:[{sourceKind:'store-boq',basisId:store.id,basisVersion:1,siteId:source.ipoId}],lines:[],transport:{issuedTo:'',vehicle:'',driver:'',driverIdentity:''}});assert.equal(saved.stockPosting,false);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_material_source_links WHERE ipo_id=$1',[source.ipoId])).rows[0].n,0);assert.equal((await db.pool.query('SELECT count(*)::int n FROM stock_on_hand_entries')).rows[0].n,0);
 }finally{await db.close();}
});
