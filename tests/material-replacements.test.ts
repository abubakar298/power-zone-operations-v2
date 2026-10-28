import {signDispatch,receiveSigned} from './signed-dispatch-fixture.js';
import {test} from 'node:test';
import request from 'supertest';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import {digest} from '../server/auth/crypto.js';
import {replacementCommittedPrintRecord,replacementDocumentPdf} from '../server/inventory/material-replacement-documents.js';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile,readdir,mkdtemp,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {migrate} from '../server/db/migrate.js';
import {testDatabase} from './database.js';
import {materialStockFixture} from './material-stock-fixture.js';
import {warehouseLedgerKey} from '../server/inventory/warehouse-source.js';
import {WarehouseAuthorityRepository,warehousePosition} from '../server/inventory/warehouse-ledger.js';
import {MaterialStockRepository} from '../server/inventory/material-stock.js';
import {MaterialReplacementsRepository,replacementIssueInputSchema,replacementUsableInputSchema} from '../server/inventory/material-replacements.js';

async function staged(pool:any){for(const [table,file]of [['inventory_warehouse_transfers','131_inventory_warehouse_transfers.sql'],['inventory_material_replacement_cases','132_inventory_material_replacements.sql'],['inventory_temporary_documents','140_inventory_temporary_documents.sql'],['inventory_signed_dispatch_pending','142_inventory_signed_dispatch_posting.sql']])if(!(await pool.query('SELECT to_regclass($1) AS table',[table])).rows[0].table)await pool.query(await readFile('migrations/'+file,'utf8'));await pool.query(await readFile('migrations/135_inventory_replacement_gate_copies.sql','utf8'));}
async function originalDispatch(pool:any,f:any,quantity='2',unit='m',warehouse='Lahore warehouse',siteCount=1){
 const draftId=randomUUID(),id=randomUUID(),lineKey=randomUUID(),siteId=randomUUID(),snapshot={kind:'fixed',parent:false,warehouse,sites:[{siteId,ipo:'FICTIONAL-COMPLETED-IPO',siteName:'Fictional completed site',installation:true,status:'Completed',items:[{privateCost:'Must not be copied into replacement context'}]}],lines:[{key:lineKey,itemId:'FINAL',unit,description:'Fictional original cable',out:quantity,sites:[siteId]}],transport:{issuedTo:'Fictional engineer',driver:'Driver',vehicle:'TEST',driverIdentity:''}};
 if(siteCount>1){const extra=randomUUID();snapshot.sites.push({...snapshot.sites[0],siteId:extra,siteName:'Fictional second parent site'});snapshot.lines[0].sites.push(extra);}
 await pool.query('INSERT INTO inventory_material_drafts(id,created_by) VALUES($1,$2)',[draftId,f.reviewer]);
 await pool.query('INSERT INTO inventory_material_draft_versions(draft_id,version,snapshot,request_key,request_fingerprint,created_by) VALUES($1,1,$2,$3,$4,$5)',[draftId,snapshot,randomUUID(),'a'.repeat(64),f.reviewer]);
 await pool.query('INSERT INTO inventory_material_dispatches(id,number,draft_id,draft_version,source_sha256,warehouse,snapshot,request_key,request_fingerprint,created_by) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9)',[id,'FICTIONAL-ORIGINAL-'+id,draftId,f.stockSha,warehouse,snapshot,randomUUID(),'b'.repeat(64),f.reviewer]);
 await pool.query('INSERT INTO inventory_material_dispatch_lines(dispatch_id,line_key,source_sha256,ledger_key,item_id,unit,description,quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,lineKey,f.stockSha,f.key,'FINAL',unit,'Fictional original cable',quantity]);
 const p=await warehousePosition(pool,f.stockSha,f.key),after=String(Number(p!.currentClosing)-Number(quantity));
 await pool.query("INSERT INTO inventory_warehouse_operational_movements(id,source_sha256,ledger_key,ledger_revision,kind,draft_id,dispatch_id,line_key,in_delta,out_delta,closing_before,closing_after,created_by) VALUES($1,$2,$3,$4,'dispatch-out',$5,$6,$7,0,$8,$9,$10,$11)",[randomUUID(),f.stockSha,f.key,p!.ledgerRevision+1,draftId,id,lineKey,quantity,p!.currentClosing,after,f.reviewer]);
 return{id,draftId,lineKey,siteId,siteIds:snapshot.sites.map(s=>s.siteId)};
}
const transport={issuedTo:'Fictional engineer',driver:'Fictional driver',vehicle:'TEST',driverIdentity:''};

test('replacement OUT works against a completed original DO; faulty return stays held until separate usable inspection credits once',async()=>{
 const db=await testDatabase({skipMigrations:true}),legacy=await mkdtemp(join(tmpdir(),'pz-replacement-legacy-'));try{
  for(const name of await readdir('migrations'))if(/^\d+_[a-z_]+\.sql$/.test(name)&&Number(name.split('_')[0])<=130)await copyFile(join('migrations',name),join(legacy,name));
  await migrate(db.pool,legacy);
  const f=await materialStockFixture(db.pool),keeper=randomUUID(),unassigned=randomUUID(),stock=new MaterialStockRepository(db.pool);
  for(const id of [keeper,unassigned])await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Fictional keeper','Inventory','isolated')",[id,id+'@example.test']);
  await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$3),($2,'Lahore warehouse','storekeeper',$3)",[f.reviewer,keeper,f.owner]);
  await new WarehouseAuthorityRepository(db.pool).command(f.owner,{warehouse:'Lahore warehouse',version:0,sourceSha256:f.stockSha,state:'active',reason:'Verified fictional baseline',requestKey:randomUUID()});
  const original=await originalDispatch(db.pool,f),before=(await db.pool.query('SELECT md5(snapshot::text) hash FROM inventory_material_dispatches WHERE id=$1',[original.id])).rows[0].hash;
  const origin='http://localhost:3000',app=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:origin,DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'replacement-isolated-http-setup-token-long'})),sessions:Record<string,{cookie:string;csrf:string}>={};
  for(const [name,id]of Object.entries({dispatcher:f.reviewer,keeper,unassigned})){const token=randomBytes(32).toString('base64url'),csrf=randomUUID();await db.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),id,csrf]);sessions[name]={cookie:'pz_session='+token,csrf};}
  const get=(name:string,path:string)=>request(app).get(path).set('Cookie',sessions[name].cookie);
  for(const role of ['Operations','Accounts']){const id=randomUUID(),token=randomBytes(32).toString('base64url'),csrf=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);await db.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),id,csrf]);sessions[role]={cookie:'pz_session='+token,csrf};}
  for(const path of ['/api/inventory-replacements/evidence','/api/material-dispatches/evidence']){await request(app).post(path).set('Origin',origin).type('json').send('{').expect(401);for(const who of ['Operations','Accounts'])await request(app).post(path).set('Origin',origin).set('Cookie',sessions[who].cookie).set('X-CSRF-Token',sessions[who].csrf).type('json').send('{').expect(403);await request(app).post(path).set('Origin',origin).set('Cookie',sessions.dispatcher.cookie).type('json').send('{').expect(403);}
  assert.equal((await get('dispatcher','/api/inventory-replacements/access')).body.enabled,false);await get('dispatcher','/api/inventory-replacements/cases?warehouse=Lahore%20warehouse').expect(409);await get('keeper','/api/material-dispatches/gate-passes').expect(200);
  await staged(db.pool);assert.equal((await db.pool.query('SELECT md5(snapshot::text) hash FROM inventory_material_dispatches WHERE id=$1',[original.id])).rows[0].hash,before);
  const repo=new MaterialReplacementsRepository(db.pool),command={originalDispatchId:original.id,originalLineKey:original.lineKey,warehouse:'Lahore warehouse',quantity:'2',expectedOriginalReturnQuantity:'2',originalSerial:null,reason:'Warranty replacement for a completed site',requestKey:randomUUID()};
  await assert.rejects(repo.open(keeper,command),/dispatcher/);await assert.rejects(repo.open(unassigned,command),/dispatcher/);await assert.rejects(repo.open(f.reviewer,{...command,quantity:'3'}),/exceeds/);await assert.rejects(repo.open(f.reviewer,{...command,originalLineKey:randomUUID()}),/original committed/);
  await request(app).post('/api/inventory-replacements/cases').set('Origin','http://wrong-origin.invalid').set('Cookie',sessions.dispatcher.cookie).set('X-CSRF-Token',sessions.dispatcher.csrf).send(command).expect(403);
  await request(app).post('/api/inventory-replacements/cases').set('Origin',origin).set('Cookie',sessions.keeper.cookie).set('X-CSRF-Token',sessions.keeper.csrf).send(command).expect(403);
  const intake=await get('dispatcher','/api/inventory-replacements/intake?warehouse=Lahore%20warehouse').expect(200);assert.ok(!JSON.stringify(intake.body).includes('privateCost'));await get('keeper','/api/inventory-replacements/intake?warehouse=Lahore%20warehouse').expect(403);await get('dispatcher','/api/inventory-replacements/intake?warehouse=Karachi%20warehouse').expect(403);
  const openedResponse=await request(app).post('/api/inventory-replacements/cases').set('Origin',origin).set('Cookie',sessions.dispatcher.cookie).set('X-CSRF-Token',sessions.dispatcher.csrf).send(command).expect(200),opened=openedResponse.body;assert.deepEqual(await repo.open(f.reviewer,command),opened);assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))!.currentClosing,'5');
  const detail=await repo.detail(keeper,opened.id);assert.ok(detail.snapshot.flags.some((v:string)=>v.includes('serial is unverified')));assert.ok(!JSON.stringify(detail).includes('privateCost'));
  const issue={caseId:opened.id,caseVersion:1,requestKey:randomUUID(),sourceSha256:f.stockSha,authorityVersion:1,ledgerRevision:1,quantity:'1',replacementSerial:null,reason:'Separate physical replacement OUT',transport};
  await assert.rejects(repo.issue(keeper,issue),/dispatcher/);await assert.rejects(repo.issue(f.reviewer,{...issue,ledgerRevision:0}),/balance changed/);await assert.rejects(repo.issue(f.reviewer,{...issue,sourceSha256:'f'.repeat(64)}),/baseline changed/);
  await request(app).post('/api/inventory-replacements/cases/'+opened.id+'/issue').set('Origin',origin).set('Cookie',sessions.dispatcher.cookie).set('X-CSRF-Token',sessions.dispatcher.csrf).send({...issue,caseId:randomUUID()}).expect(422);
  const first=(await request(app).post('/api/inventory-replacements/cases/'+opened.id+'/issue').set('Origin',origin).set('Cookie',sessions.dispatcher.cookie).set('X-CSRF-Token',sessions.dispatcher.csrf).send(issue).expect(200)).body;assert.equal(first.stockPosted,false);assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))!.currentClosing,'5');await signDispatch(db.pool,keeper,'replacement-out',first.id);assert.equal((await repo.issue(f.reviewer,issue)).stockPosted,true);assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))!.currentClosing,'4');
  await assert.rejects(repo.issue(f.reviewer,{...issue,reason:'Changed retry'}),/another replacement/);
  const secondOut=await repo.issue(f.reviewer,{...issue,caseVersion:2,ledgerRevision:2,requestKey:randomUUID(),replacementSerial:'NEW-2'});await signDispatch(db.pool,keeper,'replacement-out',secondOut.id);assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))!.currentClosing,'3');
  await assert.rejects(repo.issue(f.reviewer,{...issue,caseVersion:3,ledgerRevision:3,requestKey:randomUUID()}),/already been dispatched/);
  const evidence=await stock.uploadEvidence(keeper,{warehouse:'Lahore warehouse',filename:'FICTIONAL-faulty-return.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7 FICTIONAL FAULTY RETURN').toString('base64')});
  const returnCommand={caseId:opened.id,caseVersion:3,requestKey:randomUUID(),warehouse:'Lahore warehouse',evidenceId:evidence.id,quantity:'2',receivedSerial:null,date:'2026-10-28',reason:'Counted faulty originals in holding'};
  await assert.rejects(receiveSigned(db.pool,repo,keeper,returnCommand),/dispatcher/);
  const held=(await request(app).post('/api/inventory-replacements/cases/'+opened.id+'/faulty-return').set('Origin',origin).set('Cookie',sessions.dispatcher.cookie).set('X-CSRF-Token',sessions.dispatcher.csrf).send(returnCommand).expect(200)).body;assert.equal(held.holdingRecorded,false);const signedHeld=await receiveSigned(db.pool,repo,f.reviewer,returnCommand);assert.equal(signedHeld.id,held.id);assert.equal(signedHeld.holdingRecorded,true);
  for(const path of ['/api/inventory-replacements/out/'+first.id+'/document.pdf','/api/material-dispatches/gate-passes/replacement-out/'+first.id+'/document.pdf','/api/inventory-replacements/returns/'+held.id+'/document.pdf','/api/material-dispatches/gate-passes/replacement-in/'+held.id+'/document.pdf']){const printable=await get('keeper',path).expect(200);assert.match(printable.headers['content-type'],/pdf/);assert.match(printable.headers['cache-control'],/no-store/);await get('unassigned',path).expect(403);}
  const copiesBefore=(await warehousePosition(db.pool,f.stockSha,f.key))!.currentClosing;
  const copy={kind:'replacement-in',documentId:held.id,copyKind:'signed-store',evidenceId:evidence.id,note:'Fictional signed physical holding IGP',requestKey:randomUUID()};
  await request(app).post('/api/material-dispatches/gate-pass-copies').set('Origin',origin).set('Cookie',sessions.keeper.cookie).set('X-CSRF-Token',sessions.keeper.csrf).send(copy).expect(200);assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))!.currentClosing,copiesBefore);
  const gateRows=(await get('keeper','/api/material-dispatches/gate-passes').expect(200)).body.records;assert.ok(gateRows.some((v:any)=>v.kind==='replacement-out'&&v.id===first.id));assert.ok(gateRows.some((v:any)=>v.kind==='replacement-in'&&v.id===held.id));assert.equal(held.stockPosted,false);
  assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))!.currentClosing,'3');assert.equal((await repo.detail(keeper,opened.id)).returns[0].heldQuantity,'2');
  const normalReturn={draftId:original.draftId,requestKey:randomUUID(),sourceSha256:f.stockSha,authorityVersion:1,evidenceId:evidence.id,reason:'Ordinary path must not credit faulty holdings',lines:[{lineKey:original.lineKey,quantity:'1',ledgerRevision:3}]};
  await assert.rejects(stock.receive(f.reviewer,normalReturn),/exceeds material actually dispatched/);
  const inspect=await stock.uploadEvidence(keeper,{warehouse:'Lahore warehouse',filename:'FICTIONAL-inspection.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7 FICTIONAL USABLE INSPECTION').toString('base64')});
  const usable={returnId:held.id,caseVersion:4,requestKey:randomUUID(),sourceSha256:f.stockSha,authorityVersion:1,ledgerRevision:3,evidenceId:inspect.id,quantity:'1',usableConfirmed:true as const,itemIdentityConfirmed:true as const,reason:'Inspected one counted unit and confirmed usable'};
  assert.equal(replacementUsableInputSchema.safeParse({...usable,usableConfirmed:false}).success,false);await assert.rejects(repo.releaseUsable(keeper,usable),/dispatcher/);
  await new WarehouseAuthorityRepository(db.pool).command(f.owner,{warehouse:'Lahore warehouse',version:1,sourceSha256:f.stockSha,state:'suspended',reason:'Fictional inspection baseline hold',requestKey:randomUUID()});
  await assert.rejects(repo.releaseUsable(f.reviewer,{...usable,authorityVersion:2}),/activate/);
  await new WarehouseAuthorityRepository(db.pool).command(f.owner,{warehouse:'Lahore warehouse',version:2,sourceSha256:f.stockSha,state:'active',reason:'Fictional usable baseline reverified',requestKey:randomUUID()});usable.authorityVersion=3;
  const released=(await request(app).post('/api/inventory-replacements/returns/'+held.id+'/usable-release').set('Origin',origin).set('Cookie',sessions.dispatcher.cookie).set('X-CSRF-Token',sessions.dispatcher.csrf).send(usable).expect(200)).body;assert.deepEqual(await repo.releaseUsable(f.reviewer,usable),released);assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))!.currentClosing,'4');assert.equal((await repo.detail(keeper,opened.id)).returns[0].heldQuantity,'1');
  await assert.rejects(repo.releaseUsable(f.reviewer,{...usable,caseVersion:5,ledgerRevision:4,requestKey:randomUUID(),quantity:'2'}),/still held/);
  await repo.releaseUsable(f.reviewer,{...usable,caseVersion:5,ledgerRevision:4,requestKey:randomUUID()});assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))!.currentClosing,'5');assert.equal((await repo.detail(keeper,opened.id)).returns[0].heldQuantity,'0');
  const releasedHistory=(await get('keeper','/api/inventory-replacements/cases/'+opened.id).expect(200)).body;
  assert.equal(releasedHistory.releases.length,2,'Fully released holdings retain both immutable inspections');
  assert.deepEqual(Object.keys(releasedHistory.releases[0]).sort(),['id','returnId','quantity','createdAt','evidenceId','inspectedBy','inspectedByName','reason'].sort());
  assert.equal(releasedHistory.releases[0].inspectedBy,f.reviewer);assert.equal(releasedHistory.releases[0].evidenceId,inspect.id);
  assert.equal(releasedHistory.releases[0].quantity,'1.000000');assert.equal(releasedHistory.returns[0].heldQuantity,'0');
  assert.ok(!JSON.stringify(releasedHistory.releases).includes('serial'));assert.ok(!JSON.stringify(releasedHistory.releases).includes('privateCost'));

  await assert.rejects(stock.receive(f.reviewer,{...normalReturn,authorityVersion:3,requestKey:randomUUID(),lines:[{lineKey:original.lineKey,quantity:'1',ledgerRevision:5}]}),/exceeds material actually dispatched/);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_material_receipt_lines WHERE dispatch_id=$1',[original.id])).rows[0].n,0,'Faulty physical IGP and usable inspection are never ordinary automatic return credits.');
  for(const table of ['inventory_material_replacement_cases','inventory_material_replacement_case_versions','inventory_material_replacement_dispatches','inventory_material_replacement_returns','inventory_material_replacement_usable_releases'])await assert.rejects(db.pool.query('DELETE FROM '+table),/immutable|cannot|not allowed/i);
  const fakeMove={id:randomUUID()};await assert.rejects(db.pool.query("INSERT INTO inventory_warehouse_operational_movements(id,source_sha256,ledger_key,ledger_revision,kind,draft_id,dispatch_id,line_key,in_delta,out_delta,closing_before,closing_after,created_by,replacement_dispatch_id) VALUES($1,$2,$3,6,'dispatch-out',$4,$5,$6,0,1,5,4,$7,$8)",[fakeMove.id,f.stockSha,f.key,original.draftId,original.id,original.lineKey,f.reviewer,first.id]),/warehouse_movement_source/);
  assert.equal(replacementIssueInputSchema.safeParse({...issue,itemId:'DIFFERENT-ID'}).success,false,'A replacement never substitutes another ID supplied by the caller.');
  for(const table of ['accounts_job_closures','stock_on_hand_entries'])assert.equal((await db.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);
  const other='Karachi warehouse',otherKey=warehouseLedgerKey('FINAL',other,'m');
  await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,$2,'dispatcher',$3)",[f.reviewer,other,f.owner]);
  await db.pool.query("INSERT INTO inventory_warehouse_source_balances(source_sha256,ledger_key,payload) SELECT source_sha256,$1,jsonb_set(payload,'{warehouse}',to_jsonb($2::text)) FROM inventory_warehouse_source_balances WHERE source_sha256=$3 AND ledger_key=$4",[otherKey,other,f.stockSha,f.key]);
  await new WarehouseAuthorityRepository(db.pool).command(f.owner,{warehouse:other,version:0,sourceSha256:f.stockSha,state:'active',reason:'Verified second warehouse fixture',requestKey:randomUUID()});
  const secondOriginal=await originalDispatch(db.pool,f,'1'),second=await repo.open(f.reviewer,{...command,originalDispatchId:secondOriginal.id,originalLineKey:secondOriginal.lineKey,quantity:'1',expectedOriginalReturnQuantity:'1',requestKey:randomUUID()});
  const otherProof=await stock.uploadEvidence(f.reviewer,{warehouse:other,filename:'FICTIONAL-other-inspection.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7 FICTIONAL DESTINATION').toString('base64')});
  const otherReturn=await receiveSigned(db.pool,repo,f.reviewer,{...returnCommand,caseId:second.id,caseVersion:1,warehouse:other,evidenceId:otherProof.id,quantity:'1',requestKey:randomUUID()});
  await repo.releaseUsable(f.reviewer,{...usable,returnId:otherReturn.id,caseVersion:2,authorityVersion:1,ledgerRevision:0,evidenceId:otherProof.id,quantity:'1',requestKey:randomUUID()});
  assert.equal((await repo.detail(f.reviewer,second.id)).releases.length,1);
  const scoped=await repo.detail(keeper,second.id);assert.equal(scoped.returns.length,0);assert.equal(scoped.releases.length,0,'Source warehouse reader cannot see another unassigned destination inspection');

 }finally{await db.close();await rm(legacy,{recursive:true,force:true});}
});

test('ordinary and faulty return races cannot count more physical original units than committed DO OUT',async()=>{
 const db=await testDatabase();try{
  const f=await materialStockFixture(db.pool),stock=new MaterialStockRepository(db.pool);await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[f.reviewer,f.owner]);
  await new WarehouseAuthorityRepository(db.pool).command(f.owner,{warehouse:'Lahore warehouse',version:0,sourceSha256:f.stockSha,state:'active',reason:'Verified fictional baseline',requestKey:randomUUID()});
  const original=await originalDispatch(db.pool,f);await staged(db.pool);const repo=new MaterialReplacementsRepository(db.pool),opened=await repo.open(f.reviewer,{originalDispatchId:original.id,originalLineKey:original.lineKey,warehouse:'Lahore warehouse',quantity:'2',expectedOriginalReturnQuantity:'2',originalSerial:'OLD',reason:'Fictional original return race',requestKey:randomUUID()});
  const evidence=async(suffix:string)=>stock.uploadEvidence(f.reviewer,{warehouse:'Lahore warehouse',filename:'FICTIONAL-'+suffix+'.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7 FICTIONAL '+suffix).toString('base64')});
  const normal=await evidence('NORMAL'),faulty=await evidence('FAULTY');
  const result=await Promise.allSettled([stock.receive(f.reviewer,{draftId:original.draftId,requestKey:randomUUID(),sourceSha256:f.stockSha,authorityVersion:1,evidenceId:normal.id,reason:'Counted ordinary return from same original DO',lines:[{lineKey:original.lineKey,quantity:'2',ledgerRevision:1}]}),receiveSigned(db.pool,repo,f.reviewer,{caseId:opened.id,caseVersion:1,requestKey:randomUUID(),warehouse:'Lahore warehouse',evidenceId:faulty.id,quantity:'2',receivedSerial:'OLD',date:'2026-10-28',reason:'Counted faulty return from same original DO'})]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  const counted=(await db.pool.query('SELECT coalesce((SELECT sum(quantity) FROM inventory_material_receipt_lines WHERE dispatch_id=$1),0)+coalesce((SELECT sum(r.quantity) FROM inventory_material_replacement_returns r JOIN inventory_material_replacement_cases c ON c.id=r.case_id WHERE c.original_dispatch_id=$1),0) AS qty',[original.id])).rows[0].qty;assert.equal(Number(counted),2);
  const closing=(await warehousePosition(db.pool,f.stockSha,f.key))!.currentClosing;assert.ok(closing==='5'||closing==='7','Only the ordinary usable return winner can credit normal stock; faulty winner remains held.');
 }finally{await db.close();}
});


test('counted devices stay whole, unknown serial/return expectations stay flagged, and suspended stock cannot post replacements or usable releases',async()=>{
 const db=await testDatabase();try{
  const f=await materialStockFixture(db.pool),warehouse='Karachi warehouse',unit='No.',reviewSha='d'.repeat(64),sourceSha='e'.repeat(64);
  await f.review.importSource(f.owner,{sourceSha256:reviewSha,catalogueSha256:'b'.repeat(64),catalogue:{rows:[{itemId:'FINAL'}]},source:{groups:[{id:'devices',title:'Devices',warehouse:'Karachi',rows:[{id:'device',item:'Device',itemId:'FINAL',unit,origin:'warehouse_stock',status:'Review needed',dispatch:6,used:6,countedReturn:0,credited:0}]}]}});
  await f.warehouse.importSource(f.owner,{sourceSha256:sourceSha,catalogueSha256:'b'.repeat(64),reviewSourceSha256:reviewSha,finalItemIds:['FINAL'],source:{meta:{canonicalIds:1},balances:[{itemId:'FINAL',warehouse,unit,description:'Fictional counted device',opening:7,in:0,out:0,closing:7,openingStatus:'Reviewed source',review:''}],events:[]}});
  await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,$2,'dispatcher',$3)",[f.reviewer,warehouse,f.owner]);
  const authority=new WarehouseAuthorityRepository(db.pool),activation={warehouse,version:0,sourceSha256:sourceSha,state:'active' as const,reason:'Verified fictional counted devices',requestKey:randomUUID()};await authority.command(f.owner,activation);
  const fixture={...f,stockSha:sourceSha,key:warehouseLedgerKey('FINAL',warehouse,unit)},original=await originalDispatch(db.pool,fixture,'6',unit,warehouse);await staged(db.pool);
  const repo=new MaterialReplacementsRepository(db.pool),stock=new MaterialStockRepository(db.pool),open={originalDispatchId:original.id,originalLineKey:original.lineKey,warehouse,quantity:'2',expectedOriginalReturnQuantity:null,originalSerial:'ORIGINAL-RECORDED',reason:'Warranty device replacement after completion',requestKey:randomUUID()};
  await assert.rejects(repo.open(f.reviewer,{...open,quantity:'0.5'}),/whole items/);const opened=await repo.open(f.reviewer,open);assert.ok((await repo.detail(f.reviewer,opened.id)).snapshot.flags.some((v:string)=>v.includes('Expected original return quantity is unverified')));
  const issue={caseId:opened.id,caseVersion:1,requestKey:randomUUID(),sourceSha256:sourceSha,authorityVersion:1,ledgerRevision:1,quantity:'2',replacementSerial:null,reason:'Physical counted replacement device',transport};
  await assert.rejects(repo.issue(f.reviewer,issue),/insufficient/);const pendingOut=await repo.issue(f.reviewer,{...issue,quantity:'1'});await signDispatch(db.pool,f.reviewer,'replacement-out',pendingOut.id,warehouse);assert.equal((await warehousePosition(db.pool,sourceSha,fixture.key))!.currentClosing,'0');
  await authority.command(f.owner,{...activation,version:1,state:'suspended',requestKey:randomUUID(),reason:'Fictional verification hold'});
  await assert.rejects(repo.issue(f.reviewer,{...issue,caseVersion:2,quantity:'1',ledgerRevision:2,authorityVersion:2,requestKey:randomUUID()}),/activate/);
  const proof=await stock.uploadEvidence(f.reviewer,{warehouse,filename:'FICTIONAL-device-inspection.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7 FICTIONAL DEVICE INSPECTION').toString('base64')});
  const returned=await receiveSigned(db.pool,repo,f.reviewer,{caseId:opened.id,caseVersion:2,requestKey:randomUUID(),warehouse,evidenceId:proof.id,quantity:'1',receivedSerial:'DIFFERENT-RECEIVED-SERIAL',date:'2026-10-28',reason:'Physical faulty device counted and held'});
  assert.equal((await warehousePosition(db.pool,sourceSha,fixture.key))!.currentClosing,'0');assert.ok((await repo.detail(f.reviewer,opened.id)).returns[0].snapshot.flags.some((v:string)=>v.includes('differs')));
  const usable={returnId:returned.id,caseVersion:3,requestKey:randomUUID(),sourceSha256:sourceSha,authorityVersion:2,ledgerRevision:2,evidenceId:proof.id,quantity:'1',usableConfirmed:true as const,itemIdentityConfirmed:true as const,reason:'Inspected same final item identity and usable condition'};
  await assert.rejects(repo.releaseUsable(f.reviewer,usable),/serial mapping/);
  await authority.command(f.owner,{...activation,version:2,state:'active',requestKey:randomUUID(),reason:'Fictional verification hold resolved'});
  await assert.rejects(repo.releaseUsable(f.reviewer,{...usable,authorityVersion:3,quantity:'0.5'}),/whole items/);await assert.rejects(repo.releaseUsable(f.reviewer,{...usable,authorityVersion:3}),/Resolve the received serial mapping/);assert.equal((await warehousePosition(db.pool,sourceSha,fixture.key))!.currentClosing,'0');
  const held=(await repo.detail(f.reviewer,opened.id)).returns[0];assert.equal(held.snapshot.receivedSerial,'DIFFERENT-RECEIVED-SERIAL');assert.equal(held.heldQuantity,'1');assert.ok(held.snapshot.flags.length>0,'Mismatched serial and physical receipt evidence stay held, never discarded or silently credited.');
 }finally{await db.close();}
});


test('a replacement against a Parent DO selects its exact original site rather than inheriting every pool recipient',async()=>{
 const db=await testDatabase();try{
  const f=await materialStockFixture(db.pool);await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[f.reviewer,f.owner]);
  const original=await originalDispatch(db.pool,f,'2','m','Lahore warehouse',2);await staged(db.pool);const repo=new MaterialReplacementsRepository(db.pool),input={originalDispatchId:original.id,originalLineKey:original.lineKey,warehouse:'Lahore warehouse',quantity:'1',expectedOriginalReturnQuantity:null,originalSerial:null,reason:'Replacement at one original Parent DO site',requestKey:randomUUID()};
  await assert.rejects(repo.open(f.reviewer,input),/which original Parent DO site/);await assert.rejects(repo.open(f.reviewer,{...input,siteId:randomUUID()}),/exact site/);
  const opened=await repo.open(f.reviewer,{...input,siteId:original.siteIds[1]}),detail=await repo.detail(f.reviewer,opened.id);assert.equal(detail.snapshot.sites.length,1);assert.equal(detail.snapshot.sites[0].siteId,original.siteIds[1]);
  const proof=await new MaterialStockRepository(db.pool).uploadEvidence(f.reviewer,{warehouse:'Lahore warehouse',filename:'FICTIONAL-different-returned-id.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7 FICTIONAL DIFFERENT RETURNED ID').toString('base64')});
  const held=await receiveSigned(db.pool,repo,f.reviewer,{caseId:opened.id,caseVersion:1,requestKey:randomUUID(),warehouse:'Lahore warehouse',evidenceId:proof.id,quantity:'1',receivedItemId:'DIFFERENT-FINAL-ID',receivedUnit:'m',receivedSerial:null,date:'2026-10-28',reason:'Record actual mismatched return in holding for identity review'});
  await assert.rejects(repo.releaseUsable(f.reviewer,{returnId:held.id,caseVersion:2,requestKey:randomUUID(),sourceSha256:f.stockSha,authorityVersion:1,ledgerRevision:1,evidenceId:proof.id,quantity:'1',usableConfirmed:true,itemIdentityConfirmed:true,reason:'A checkbox cannot silently substitute the received final ID'}),/Resolve the received item ID/);
  assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))!.currentClosing,'5');assert.equal((await repo.detail(f.reviewer,opened.id)).returns[0].snapshot.receivedItemId,'DIFFERENT-FINAL-ID');
 }finally{await db.close();}
});


async function pdfText(bytes:Buffer){const job=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});try{const pdf=await job.promise,parts:string[]=[];for(let i=1;i<=pdf.numPages;i++)parts.push((await(await pdf.getPage(i)).getTextContent()).items.map((v:any)=>v.str??'').join(' '));return parts.join(' ');}finally{await job.destroy();}}
test('whitelisted replacement PDFs distinguish faulty custody from usable stock, omit BOQ pricing and show at most two decimals',async()=>{
 const original={number:'FICTIONAL-DO-001',description:'Fictional original material with a description wrapping beneath its own primary item',itemId:'FINAL',unit:'m',serial:null},base={id:randomUUID(),number:'FICTIONAL-REPLACEMENT',warehouse:'Fictional warehouse',case_id:randomUUID(),created_at:new Date('2026-10-28T00:00:00Z')},privateFields={privateCost:'998877.66',sellingPrice:'112233.44',completeBoq:[{rate:'556677.88'}]},sites=[{siteName:'Fictional site',customer:'Fictional customer',ipo:'IPO-TEST',orderNumber:'1/TEST',customerPo:'PO-TEST',items:[privateFields]}];
 const out=replacementCommittedPrintRecord({...base,snapshot:{original,sites,lines:[{itemId:'FINAL',unit:'m',description:original.description,quantity:'1.234567',serial:'NEW-TEST',...privateFields}],reason:'Fictional outgoing warranty item',...privateFields}},'replacement-out');
 assert.ok(!JSON.stringify(out).includes('998877'));const outText=await pdfText(replacementDocumentPdf(out));assert.match(outText,/Replacement Delivery Note/);assert.match(outText,/REPLACEMENT OUT/);for(const label of ['Customer copy','Gate copy','Handover evidence','Storekeeper copy'])assert.ok(outText.includes(label));assert.match(outText,/1\.23/);assert.ok(!outText.includes('1.234567'));assert.ok(!outText.includes('998877'));assert.equal(out.lines[0].quantity,'1.234567');
 const held=replacementCommittedPrintRecord({...base,snapshot:{original,sites,itemId:'FINAL',unit:'m',expectedItemId:'FINAL',expectedUnit:'m',receivedItemId:null,receivedUnit:null,receivedSerial:null,quantity:'1.234567',reason:'Counted faulty material awaiting inspection',...privateFields}},'replacement-in'),heldText=await pdfText(replacementDocumentPdf(held));
 assert.match(heldText,/Replacement Return IGP/);assert.match(heldText,/Not available for normal issue/);assert.match(heldText,/physical custody only/);assert.match(heldText,/Unverified returned ID/);assert.ok(!heldText.includes('RECEIVED - WAREHOUSE IN'));assert.ok(!heldText.includes('112233'));
});


test('a returned later replacement serial cannot settle the original item or receive usable credit through an unsupported recursive case',async()=>{
 const db=await testDatabase();try{
  const f=await materialStockFixture(db.pool),warehouse='Lahore warehouse';await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,$2,'dispatcher',$3)",[f.reviewer,warehouse,f.owner]);await new WarehouseAuthorityRepository(db.pool).command(f.owner,{warehouse,version:0,sourceSha256:f.stockSha,state:'active',reason:'Verified fictional baseline',requestKey:randomUUID()});
  const original=await originalDispatch(db.pool,f),repo=new MaterialReplacementsRepository(db.pool),stock=new MaterialStockRepository(db.pool);await staged(db.pool);const opened=await repo.open(f.reviewer,{originalDispatchId:original.id,originalLineKey:original.lineKey,warehouse,quantity:'1',expectedOriginalReturnQuantity:'1',originalSerial:null,reason:'First replacement with unknown original serial',requestKey:randomUUID()});
  const outgoing=await repo.issue(f.reviewer,{caseId:opened.id,caseVersion:1,requestKey:randomUUID(),sourceSha256:f.stockSha,authorityVersion:1,ledgerRevision:1,quantity:'1',replacementSerial:'NEW-LATER',reason:'Fictional first replacement OUT',transport});
  await signDispatch(db.pool,f.reviewer,'replacement-out',outgoing.id,warehouse);
  const evidence=await stock.uploadEvidence(f.reviewer,{warehouse,filename:'FICTIONAL-later-replacement-return.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7 FICTIONAL LATER REPLACEMENT RETURN').toString('base64')});
  const held=await receiveSigned(db.pool,repo,f.reviewer,{caseId:opened.id,caseVersion:2,requestKey:randomUUID(),warehouse,evidenceId:evidence.id,quantity:'1',receivedItemId:'FINAL',receivedUnit:'m',receivedSerial:'NEW-LATER',date:'2026-10-28',reason:'Preserve physical return of known later replacement unit'});
  const record=(await repo.detail(f.reviewer,opened.id)).returns[0];assert.equal(record.snapshot.returnIdentity,'replacement-unit');assert.equal(record.heldQuantity,'1');assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))!.currentClosing,'4');
  await assert.rejects(repo.releaseUsable(f.reviewer,{returnId:held.id,caseVersion:3,requestKey:randomUUID(),sourceSha256:f.stockSha,authorityVersion:1,ledgerRevision:2,evidenceId:evidence.id,quantity:'1',usableConfirmed:true,itemIdentityConfirmed:true,reason:'A later replacement must not settle the original'}),/later replacement-unit return/);
  await assert.rejects(repo.open(f.reviewer,{originalDispatchId:outgoing.id,originalLineKey:original.lineKey,warehouse,quantity:'1',expectedOriginalReturnQuantity:'1',originalSerial:'NEW-LATER',reason:'Recursive replacement is explicitly unsupported here',requestKey:randomUUID()}),/original committed material DO/);
  assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))!.currentClosing,'4');
 }finally{await db.close();}
});
