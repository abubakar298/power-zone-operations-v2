import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {AccountsSourceRegisters,type AccountsSource} from '../server/accounts/source-registers.js';
import {historicalPoDate,importPendingIpo} from '../server/inventory/pending-ipo-import.js';
import {MaterialDraftRepository} from '../server/inventory/material-drafts.js';
import {OrdersRepository} from '../server/orders/repository.js';
import {OperationsRepository} from '../server/operations/repository.js';
import {ProjectWorkflowRepository} from '../server/project-workflow/repository.js';
import {upsPortfolio} from '../server/director/ups-portfolio.js';
import {receiptSchema} from '../server/project-workflow/schema.js';
test('authorised historical pending orders use real approved issuance calculations, share UPS numbers safely and never replay stock, invoices, receipts or IPO Shared handoffs',async()=>{
 const previous=process.env.ENABLE_DEFERRED_UPS_WORKFLOW;process.env.ENABLE_DEFERRED_UPS_WORKFLOW='true';
 const db=await testDatabase();try{
  const users:Record<string,string>={};
  for(const [key,role] of [['owner','Admin'],['coordinator','Coordinator'],['inventory','Inventory']]){users[key]=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[users[key],key+'@example.test',key==='coordinator'?'Atif import fixture':key,role,'isolated']);}
  await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[users.inventory,users.owner]);
  const setups=[['UBL','250','1','6-10','900000','9900163'],['UBL','250','2','6-10','900000','9900163'],['MBL','60','1','6-5','660000','9900338'],['MBL','20','1','6-10','935000','9900233'],['MBL','80','1','6-10','935000','9900149']];
  const rows=setups.map(([bank,total,n,cfg,gross,number],index)=>({key:bank+':UPS:'+n+'/'+total,customer:bank,kind:'UPS',program:total,ipo:'CHP-'+number,orderNumber:n+'/'+total,site:'Isolated historical branch '+index,siteCode:bank==='UBL'?'9999':'H-'+index,po:'LOCAL-HIST-PO-'+index,poDate:'2026-10-25',configuration:bank==='UBL'?'0-'+cfg:cfg,grossContract:gross,cancelled:false,delivered:false,installed:false,invoiceReferences:[]}));
  const bad={...rows[2],key:'MBL:UPS:2/60',orderNumber:'2/60',site:'Rejected import branch',siteCode:'REJECTED-HIST',po:'REJECTED-PO',grossContract:'1'};
  const source:AccountsSource={sourceDate:'2026-10-26',manifest:[{name:'isolated-authorised-register',sha256:'a'.repeat(64)}],registers:[{rows:[...rows,bad]}],cables:{rows:[]},internet:{rows:[]},sites:{rows:[]},evidence:{rows:[],cableStageAdjustments:[]}};
  const saved=await new AccountsSourceRegisters(db.pool).import(users.owner,source,0);
  for(const r of [...rows,bad]){const id='registered-'+r.key,b={id,ipo:r.ipo+' · '+r.orderNumber,name:r.site,customer:r.customer,customerPo:r.po,sourceKey:r.key,stage:'received',installation:true,sample:false};await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[id,users.owner]);await db.pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,$3,$4,$5,$6)',[id,b,'Source imported','isolated authorised register',randomUUID(),users.owner]);}
  const framework=async(bank:string,cfg:string)=>(await db.pool.query('SELECT id FROM project_framework_current WHERE configuration_key=$1',[bank+'-UPS-'+cfg])).rows[0].id;
  const first={boardSiteId:'registered-'+rows[0].key,boardVersion:1,sourceVersion:saved.version,frameworkId:await framework('UBL','6-10'),requestKey:randomUUID(),reason:'Owner-authorised isolated historical register import; original scan absent.'};
  await assert.rejects(importPendingIpo(db.pool,users.inventory,first),(error:any)=>error.status===403);
  await assert.rejects(importPendingIpo(db.pool,users.owner,{...first,sourceVersion:2}),/register changed/);
  delete process.env.ENABLE_DEFERRED_UPS_WORKFLOW;await assert.rejects(importPendingIpo(db.pool,users.owner,first),/deferred/);process.env.ENABLE_DEFERRED_UPS_WORKFLOW='true';
  const firstResult=await importPendingIpo(db.pool,users.owner,first);assert.equal(firstResult.unchanged,false);assert.equal((await importPendingIpo(db.pool,users.owner,first)).unchanged,true);assert.equal((await importPendingIpo(db.pool,users.owner,{...first,requestKey:randomUUID()})).unchanged,true);
  for(let i=1;i<rows.length;i++){const [bank,,,cfg]=setups[i];await importPendingIpo(db.pool,users.owner,{...first,boardSiteId:'registered-'+rows[i].key,frameworkId:await framework(bank,cfg),requestKey:randomUUID()});}
  const ipos=(await db.pool.query('SELECT * FROM internal_purchase_orders ORDER BY created_at,id')).rows;assert.equal(ipos.length,5);assert.equal(ipos.filter(r=>r.number==='CHP-9900163').length,2);
  for(const row of rows){const ipo=ipos.find(r=>r.number===row.ipo&&r.snapshot.input.orderNumber===row.orderNumber);assert.ok(ipo);assert.equal(ipo.snapshot.input.poNumber,row.po);assert.equal(ipo.snapshot.input.evidenceType,'Historical source register');assert.equal(ipo.snapshot.historicalImport.originalCustomerEvidenceUploaded,false);assert.equal(ipo.snapshot.allocation.total,Number(row.grossContract).toFixed(2));}
  const intake=await new MaterialDraftRepository(db.pool).intake(users.inventory);assert.equal(intake.sources.filter(s=>s.sourceKind==='linked-ipo').length,5);assert.equal(intake.registeredPending.length,1);
  assert.equal((await new OrdersRepository(db.pool).list(users.coordinator)).length,0);assert.equal((await new OperationsRepository(db.pool).list()).length,0);assert.equal((await new ProjectWorkflowRepository(db.pool).list(users.owner,'coordination','team')).records.length,0);
  assert.equal((await upsPortfolio(db.pool,users.owner,'UBL')).rows.length,2);assert.equal((await upsPortfolio(db.pool,users.owner,'MBL')).rows.length,3);
  for(const table of ['ipo_accounts_handoffs','accounts_job_closures','stock_on_hand_entries'])assert.equal((await db.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);
  const before=(await db.pool.query('SELECT count(*)::int n FROM sites')).rows[0].n;
  await assert.rejects(importPendingIpo(db.pool,users.owner,{...first,boardSiteId:'registered-'+bad.key,frameworkId:await framework('MBL','6-5'),requestKey:randomUUID()}),/contract value differs/);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM sites')).rows[0].n,before,'Failed import rolls back a newly prepared site too.');assert.equal((await db.pool.query('SELECT count(*)::int n FROM internal_purchase_orders')).rows[0].n,5);
  await assert.rejects(db.pool.query('DELETE FROM historical_pending_ipo_imports'));
  assert.equal(receiptSchema.safeParse({historicalImport:true}).success,false,'Normal employee PO receipt schema cannot enable operator-only historical import.');
 }finally{await db.close();if(previous===undefined)delete process.env.ENABLE_DEFERRED_UPS_WORKFLOW;else process.env.ENABLE_DEFERRED_UPS_WORKFLOW=previous;}
});

test('historical named-month PO dates are explicit and preserve chronology without locale guesses',()=>{
 assert.equal(historicalPoDate('3-Mar-2026'),'2026-03-03');assert.equal(historicalPoDate('21-Jul-2025'),'2025-07-21');assert.equal(historicalPoDate('2026-10-25'),'2026-10-25');assert.equal(historicalPoDate('29-Feb-2024'),'2024-02-29');
 for(const value of ['31-Feb-2026','29-Feb-2025','03/04/2026','4-XYZ-2026'])assert.throws(()=>historicalPoDate(value),/valid ISO date/);
});
