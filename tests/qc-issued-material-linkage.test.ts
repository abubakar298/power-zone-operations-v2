import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import request from 'supertest';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import {hashPassword} from '../server/auth/crypto.js';
import type {Pool} from 'pg';
import {qcMaterialHandoff} from '../server/accounts/qc-material-handoff.js';
import {routeMaterialCosting} from '../server/accounts/material-costing.js';
import {historicalQcIssues} from '../server/inventory/historical-qc-issues.js';
import {MaterialUsageRepository} from '../server/inventory/material-usage.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import {testDatabase} from './database.js';
import {materialStockFixture} from './material-stock-fixture.js';

const password='isolated-qc-linkage-test-password';
async function qcActor(pool:Pool,owner:string,team='central'){
 const id=randomUUID();
 await pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'QC fixture','Operations',$3)",[id,id+'@example.test',await hashPassword(password)]);
 await pool.query("INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,'qc',$2,$3)",[id,team,owner]);
 return id;
}
async function localDeclaration(pool:Pool,actor:string,siteId:string){
 await pool.query('INSERT INTO operations_site_local_purchase_versions(site_id,version,snapshot,request_key,request_fingerprint,created_by) VALUES($1,1,$2,$3,$4,$5)',[siteId,{items:[],noWarehouseMaterials:false},randomUUID(),'b'.repeat(64),actor]);
}

test('historical issued quantities enable QC usage without replacing PT or writing warehouse records',async()=>{
 const db=await testDatabase();try{
  const owner=randomUUID();
  await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Owner','Management','isolated')",[owner,owner+'@example.test']);
  const qc=await qcActor(db.pool,owner),other=await qcActor(db.pool,owner,'south');
  const id='registered-UBL:SOLAR:232',ipo='CHP-232',board=new OperationsBoardRepository(db.pool);
  await board.importSource(owner,{sourceSha256:'e'.repeat(64),rows:[{id,ipo,name:'Historical linkage fixture',customer:'UBL',installation:true,projectType:'solar',stage:'delivered',completed:true,operationsTeam:'central'}]});
  const repo=new MaterialUsageRepository(db.pool),initial=await repo.historicalQcSite(qc,id);
  const origin='http://127.0.0.1:3000', app=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:origin,DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'isolated-qc-linkage-token-long-enough'}));
  const session=await request(app).post('/api/auth/login').set('Origin',origin).send({email:qc+'@example.test',password});
  assert.equal(session.status,200,session.text);
  const endpoint='/api/material-dispatches/qc/sites/'+encodeURIComponent(id)+'/historical-usage';
  const headers={Cookie:session.headers['set-cookie'] as unknown as string[],Origin:origin,'X-CSRF-Token':session.body.csrfToken as string};
  const response=await request(app).get(endpoint).set('Cookie',headers.Cookie);
  assert.equal(response.status,200,response.text);
  assert.equal(response.body.linkedIssues,true);
  assert.ok('linkedIssues' in initial&&initial.issued.length);
  assert.equal(initial.entry,null);
  assert.equal(initial.needsSignedDo,true);
  assert.equal(historicalQcIssues(id,'CHP-233'),null);
  await assert.rejects(repo.historicalQcSite(other,id),/assigned team/);

  const usage=Object.fromEntries(initial.issued.map((line,index)=>[line.key,index===0&&!line.variable?line.issued:'0']));
  const entry={start:'',end:'',panelCount:'',panelWattage:'',usage,remarks:'Verified quantities from signed site records',expectedReturns:'',receivedReturns:'',extra:[]};
  const input={version:0,entry,reason:'Verify against signed site records',verify:true,requestKey:randomUUID()};
  await assert.rejects(repo.saveHistoricalQcSite(qc,id,input),/signed delivery DO/);
  const saved=await repo.saveHistoricalQcSite(qc,id,{...input,verify:false,requestKey:randomUUID()});
  assert.equal(saved.version,1);

  const upload=(name:string)=>board.upload(owner,id,{filename:name+'.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7\n'+name).toString('base64')});
  const [signedDo,vso]=await Promise.all([upload('Signed DO'),upload('Signed VSO')]);
  await board.command(owner,id,{action:'historical-evidence',category:'delivery',version:1,date:'2026-01-01',signedDoId:signedDo.id,edit:false,reason:'Original signed delivery',requestKey:randomUUID()});
  await board.command(owner,id,{action:'historical-evidence',category:'handover',version:2,date:'2026-01-01',variableSignoffId:vso.id,edit:false,reason:'Original signed site usage',requestKey:randomUUID()});
  const key=initial.jobKey,ptKey='site:'+id;
  await db.pool.query("INSERT INTO accounts_job_pt_entries(id,job_key,site_id,pt_reference,entry_date,notes,snapshot,request,request_key,created_by) VALUES($1,$2,$3,'PT-PRESERVED','2026-11-01','','{}','{}',$4,$5)",[randomUUID(),ptKey,id,randomUUID(),owner]);
  const pt=(await db.pool.query('SELECT * FROM accounts_job_pt_entries')).rows;
  const before=(await qcMaterialHandoff(db.pool,key))!;
  assert.match(before.holds.join(';'),/usage pending/);
  assert.equal(routeMaterialCosting([],[before],[],pt,[])[0].ptReference,'PT-PRESERVED');
  const verify={...input,version:1,requestKey:randomUUID()};
  const savedByQc=await request(app).post(endpoint).set('Cookie',headers.Cookie).set('Origin',origin).set('X-CSRF-Token',headers['X-CSRF-Token']).send(verify);
  assert.equal(savedByQc.status,200,savedByQc.text);
  assert.equal(savedByQc.body.version,2);
  assert.equal((await repo.saveHistoricalQcSite(qc,id,verify)).version,2);
  assert.match((await qcMaterialHandoff(db.pool,key))!.holds.join(';'),/local purchases/);
  await localDeclaration(db.pool,qc,id);
  const ready=(await qcMaterialHandoff(db.pool,key))!;
  assert.equal(ready.ready,true);
  assert.equal(ready.usage.length,initial.issued.length);
  assert.equal(routeMaterialCosting([],[ready],[],pt,[]).length,0,'Already recorded PT leaves Material Costing when QC is ready');
  assert.deepEqual((await db.pool.query('SELECT * FROM accounts_job_pt_entries')).rows,pt);
  for(const table of ['inventory_reports','inventory_warehouse_operational_movements'])assert.equal((await db.pool.query('SELECT 1 FROM '+table)).rowCount,0);
 }finally{await db.close();}
});

test('reviewed pre-gate DO lines are available to QC only; warehouse gate state and stock stay pending',async()=>{
 const db=await testDatabase();try{
  const itemId='CH-BMS-HV',f=await materialStockFixture(db.pool,itemId);
  const qc=await qcActor(db.pool,f.owner),coord=randomUUID();
  await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Coordinator','Coordinator','isolated')",[coord,coord+'@example.test']);
  const {createDashboardSamples}=await import('../server/coordinator/samples.js');
  const ipoId=(await createDashboardSamples(db.pool,coord,f.owner)).find((r:any)=>r.ipoId)!.ipoId;
  const boardId='registered-UBL:UPS:176/250',file=randomUUID(),siteId=ipoId,warehouse='Lahore warehouse',draftId=randomUUID(),lineKey=randomUUID();
  const board={id:boardId,name:'Reviewed native fixture',ipo:'CHP-163(176/250)',customer:'UBL',origin:{ipoId},stage:'delivered',installation:true,completed:true,projectType:'ups',operationsTeam:'central',deliveries:[{signedDo:{id:file},deliveryDate:'2026-11-01',partial:false}],documents:[]};
  await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[boardId,f.owner]);
  await db.pool.query("INSERT INTO operations_board_files(id,site_id,filename,media_type,sha256,content,created_by) VALUES($1,$2,'signed-do.pdf','application/pdf',$3,$4,$5)",[file,boardId,'a'.repeat(64),Buffer.from('%PDF-1.7 signed'),f.owner]);
  await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Fixture','Fixture',$3,$4)",[boardId,board,randomUUID(),f.owner]);
  const snapshot={kind:'fixed',parent:false,warehouse,status:'issued',stockPosting:false,sites:[{siteId,basisId:randomUUID(),basisVersion:1,registeredSiteId:boardId,siteName:board.name,ipo:board.ipo,installation:true}],lines:[{key:lineKey,itemId,description:'High-voltage BMS',out:'2',unit:'m',sites:[siteId]}]};
  await db.pool.query('INSERT INTO inventory_material_drafts(id,created_by) VALUES($1,$2)',[draftId,f.owner]);
  await db.pool.query('INSERT INTO inventory_material_draft_versions(draft_id,version,snapshot,request_key,request_fingerprint,created_by) VALUES($1,1,$2,$3,$4,$5)',[draftId,snapshot,randomUUID(),'a'.repeat(64),f.owner]);
  async function pendingDo(id:string,number:string,qty:string){
   await db.pool.query('INSERT INTO inventory_material_dispatches(id,number,draft_id,draft_version,source_sha256,warehouse,snapshot,request_key,request_fingerprint,created_by) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9)',[id,number,draftId,f.stockSha,warehouse,snapshot,randomUUID(),'b'.repeat(64),f.owner]);
   await db.pool.query('INSERT INTO inventory_material_dispatch_lines(dispatch_id,line_key,source_sha256,ledger_key,item_id,unit,description,quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,lineKey,f.stockSha,f.key,itemId,'m','High-voltage BMS',qty]);
   await db.pool.query("INSERT INTO inventory_signed_dispatch_pending(document_kind,document_id,warehouse,source_sha256,authority_version,movements,created_by) VALUES('dispatch',$1,$2,$3,1,'[]',$4)",[id,warehouse,f.stockSha,f.owner]);
  }
  await pendingDo('ca636da9-db6b-466e-a9e6-4db0af19c2c2','Reviewed native DO','2');
  await pendingDo(randomUUID(),'Unreviewed native DO','3');
  const repo=new MaterialUsageRepository(db.pool);
  assert.equal((await repo.read(f.owner,draftId)).reconciliation,null);
  const qcView=await repo.qcSite(qc,boardId);
  assert.equal(qcView.records[0].lines[0].issued,'2');
  const key='ipo:'+ipoId;
  assert.equal((await qcMaterialHandoff(db.pool,key))!.usage[0].issued,'2');
  await localDeclaration(db.pool,qc,boardId);
  await repo.save(qc,{draftId,siteId,version:0,workflowVersion:2,date:'2026-11-01',state:'signed',reason:'Verified on signed delivery DO',customerEvidenceId:null,internalEvidenceId:file,lines:[{lineKey,issued:'2',used:'1',returned:null}],requestKey:randomUUID()});
  assert.equal((await qcMaterialHandoff(db.pool,key))!.ready,true);
  assert.equal((await repo.read(f.owner,draftId)).reconciliation,null);
  for(const table of ['inventory_signed_dispatch_postings','inventory_warehouse_operational_movements'])assert.equal((await db.pool.query('SELECT 1 FROM '+table)).rowCount,0);
 }finally{await db.close();}
});

test('New Fruit Market links only its five signed equipment lines and holds the untraced handwritten items',()=>{
 const site='registered-MBL:CHP-338:60-site order:22/60';
 const issue=historicalQcIssues(site,'CHP-338 · 22/60')!;
 assert.equal(issue.lines.length,5);
 assert.ok(issue.lines.every(line=>line.reference==='DO808-KHI-BASELINE'&&line.issued==='1'));
 assert.match(issue.review!,/channel duct and 10 ft of flexible pipe/);
 assert.equal(historicalQcIssues(site,'CHP-338 · 23/60'),null);
});

test('later reviewed stock log issues stay exact to their IPO/order and preserve partial delivery holds',()=>{
 const jaranwala=historicalQcIssues('registered-UBL:UPS:183/250','CHP-163 · 183/250')!;
 assert.equal(jaranwala.lines.length,5);
 assert.equal(jaranwala.lines.find(line=>line.itemId==='CH-BAT-LV-05 KW')?.issued,'2');
 assert.equal(jaranwala.review,undefined);
 assert.equal(historicalQcIssues('registered-UBL:UPS:183/250','CHP-163 · 185/250'),null);
 const gojra=historicalQcIssues('registered-UBL:SOLAR:347','CHP-347')!;
 assert.deepEqual(gojra.lines.map(line=>[line.reference,line.issued]),[['CPZ-DO-833','33']]);
 assert.match(gojra.review!,/partial/);
});

test('Noorkot keeps the panel issue and links both remaining signed deliveries to CHP-349',()=>{
 const site='registered-UBL:SOLAR:349';
 const issue=historicalQcIssues(site,'CHP-349')!;
 const byDo=(reference:string)=>issue.lines.filter(line=>line.reference===reference);
 assert.deepEqual(byDo('DO810').map(line=>line.issued),['49']);
 assert.equal(byDo('CPZ-DO-815').length,14);
 assert.equal(byDo('CPZ-DO-816').length,31);
 assert.deepEqual(byDo('CPZ-DO-815').slice(0,3).map(line=>[line.issued,line.variable]),[['2',false],['8',false],['2',false]]);
 assert.deepEqual(byDo('CPZ-DO-816').filter(line=>line.itemId.startsWith('CH-CBL-DC')).map(line=>[line.issued,line.unit,line.variable]),[['165','m',true],['166','m',true]]);
 assert.equal(byDo('CPZ-DO-815').find(line=>line.itemId==='CH-Pvc Pipe 1.5 Inch')?.unit,'length');
 assert.equal(new Set(issue.lines.map(line=>line.key)).size,46);
 assert.equal(issue.review,undefined);
 assert.equal(historicalQcIssues(site,'CHP-348'),null);
});

test('Architect Society uses signed DO863 for order 184/250 and rejects order 65/250',()=>{
 const site='registered-UBL:UPS:184/250';
 const issue=historicalQcIssues(site,'CHP-163 · 184/250')!;
 assert.deepEqual(issue.lines.map(line=>[line.itemId,line.issued,line.unit]),[
  ['CH-PCS-HYB-1P-006','1','piece'],
  ['CH-BMS-LV','1','piece'],
  ['CH-BAT-LV-05 KW','2','piece'],
  ['CH-VPD-63A/2P','1','piece'],
  ['CH-5WAY-DB','1','piece'],
  ['CH-Duct Slot 60x60','1','piece'],
  ['CH-Flex Pipe 1','10','ft'],
 ]);
 assert.ok(issue.lines.every(line=>line.reference==='CPZ-DO-863'));
 assert.equal(issue.review,undefined);
 assert.equal(historicalQcIssues(site,'CHP-163 · 65/250'),null);
});
