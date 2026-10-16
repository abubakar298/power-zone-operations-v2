import {workflowBoundary} from '../server/http/permissions.js';
import {flagUpsInstallations,upsInstallationAlerts,daysSinceDelivery} from '../server/director/ups-alerts.js';
import {approveUpsRegisterCompletions} from '../server/director/ups-completions.js';
import {Decimal} from 'decimal.js';
import {frameworkBasis} from '../server/project-workflow/basis.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {importUpsManagementRegister,upsActiveRegister} from '../server/director/ups-register.js';
import {upsPortfolio} from '../server/director/ups-portfolio.js';

const input=(customer='UBL',reference='CHP-163',total=250)=>({customer,projectReference:reference,configuration:customer==='UBL'?'6-10':'6-5',totalSites:total,sourceSheet:reference+' '+customer,source:{filename:'Chint_Site_Cost_Analysis.xlsx',sha256:'a'.repeat(64)},sites:[{orderNumber:`1/${total}`,invoiceReference:`INV-1/${total}`,invoiceDate:'2026-10-14',invoiceStatus:'Invoiced',sourceRow:13},{orderNumber:`2/${total}`,invoiceReference:'',invoiceDate:'',invoiceStatus:'Not invoiced',sourceRow:14}]});

test('Management register is additive, idempotent, source-linked and independent of IPO/workflow/costs',async()=>{
 const db=await testDatabase();try{
  const actor=randomUUID(),atif=randomUUID();
  for(const [id,role] of [[actor,'Management'],[atif,'Coordinator']])await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash)VALUES($1,$2,'Register test',$3,'isolated-only')",[id,id+'@test.invalid',role]);
  const tables=['sites','project_workflow_records','internal_purchase_orders','project_po_receipts','accounts_job_closures','ups_management_budget_versions','document_sequences'];
  const fingerprint=async()=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await db.pool.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,'')) AS hash FROM ${t} r`)).rows[0].hash])));
  const before=await fingerprint();
  await assert.rejects(importUpsManagementRegister(db.pool,atif,input()),/management access/);
  assert.equal((await importUpsManagementRegister(db.pool,actor,input())).imported,2);
  assert.equal((await importUpsManagementRegister(db.pool,actor,input())).unchanged,2);
  assert.equal((await db.pool.query('SELECT count(*) AS n FROM ups_management_program_versions')).rows[0].n,'1');
  await assert.rejects(importUpsManagementRegister(db.pool,actor,{...input(),totalSites:249}),/within the stated order/);
  await assert.rejects(importUpsManagementRegister(db.pool,actor,{...input(),sites:[input().sites[0],input().sites[0]]}),/unique/);
  await assert.rejects(importUpsManagementRegister(db.pool,actor,{...input(),sourceSheet:'A different sheet'}),/different saved information/);
  await assert.rejects(importUpsManagementRegister(db.pool,actor,{...input(),configuration:'6-5'}),/approved customer UPS option/);
  await assert.rejects(importUpsManagementRegister(db.pool,actor,{...input(),sites:[{...input().sites[1],invoiceReference:'invented'}]}),/Do not invent/);
  await assert.rejects(importUpsManagementRegister(db.pool,actor,{...input(),budgetedCost:'12345'}));
  await importUpsManagementRegister(db.pool,actor,input('MBL','CHP-220',80));
  await importUpsManagementRegister(db.pool,actor,input('MBL','CHP-338',60));
  const legacy={...input('MBL','CHP-999',10),sites:[{...input().sites[0],orderNumber:'',legacyJobId:'CHJ-192',ipoNumber:'CHP-192',siteName:'Meezan Ayesha Masjid'},{...input().sites[0],orderNumber:'',legacyJobId:'CHJ-193',ipoNumber:'CHP-192',siteName:'Meezan Other branch'}]};
  const legacyResult=await importUpsManagementRegister(db.pool,actor,legacy);assert.equal(legacyResult.imported,2);
  await assert.rejects(importUpsManagementRegister(db.pool,actor,{...legacy,projectReference:'CHP-998',sites:legacy.sites.map(s=>({...s,legacyJobId:''}))}),/unique/);
  const ubl=await upsPortfolio(db.pool,actor,'UBL'),mbl=await upsPortfolio(db.pool,actor,'MBL');
  assert.equal(ubl.register.activeSites,2);assert.equal(ubl.register.totalOrdered,250);assert.equal(ubl.register.remainingSites,248);
  assert.equal(mbl.register.activeSites,6);assert.equal(mbl.register.totalOrdered,150);
  assert.equal(ubl.rows.length,0);assert.equal(ubl.actual.sites,0);assert.equal(ubl.totals.budgetedCost,'0.00');
  assert.equal(ubl.budgeted?.sites,2);assert.equal(ubl.budgeted?.sellingExGst,'1525423.72');assert.equal(mbl.budgeted?.sites,6);assert.equal(mbl.budgeted?.sellingExGst,'3355932.18');
  const approved=(await db.pool.query("SELECT * FROM project_framework_current WHERE configuration_key='UBL-UPS-6-10'")).rows[0];
  const unit=await frameworkBasis(db.pool,db.pool,{customer_id:approved.customer_id,site_name:'Disposable budget check',site_code:'PORTFOLIO',route:'direct-framework'},approved.id);
  assert.equal(ubl.budgeted?.cost,new Decimal(unit.boq.total).mul(2).toFixed(2));assert.equal(ubl.budgeted?.profit,new Decimal(ubl.budgeted!.sellingExGst).sub(ubl.budgeted!.cost).toFixed(2));
  assert.equal(ubl.budgeted?.markupPercent,new Decimal(ubl.budgeted!.profit).div(ubl.budgeted!.cost).mul(100).toFixed(2));
  assert.equal(mbl.actual.sites,0);
  assert.deepEqual(await fingerprint(),before,'All existing master, workflow, document, budget, closure and counter data remain untouched');
  const latest=(await db.pool.query('SELECT program_key,version,snapshot FROM ups_management_program_versions')).rows;
  const issued=[{id:'real-ipo',number:'CHP-338',orderNumber:'1/60',configuration:'6-5',site:'Real branch',siteCode:'0208'},{id:'existing20',number:'CHP-338',orderNumber:'20/60',configuration:'6-5',site:'Consumer Hub Lahore',siteCode:'code'}];
  const register=upsActiveRegister(latest.filter(p=>p.snapshot.managementRegister.customer==='MBL'),issued);
  assert.equal(register.activeSites,7);assert.equal(register.rows.filter(r=>r.ipoId==='real-ipo').length,1);assert.equal(register.rows.find(r=>r.ipoId==='real-ipo').site,'Real branch');
  assert.equal(register.programs.find(p=>p.projectReference==='CHP-338')!.activeSites,3);assert.equal(register.rows.filter(r=>r.ipoId==='existing20').length,1);
  const completion={programKey:'UPS:UBL:CHP-163',expectedVersion:1,source:{fileId:'recovery-test',filename:'Recovery.xlsx',sha256:'b'.repeat(64),sheet:'UBL Chint',url:'https://docs.google.com/spreadsheets/d/recovery-test'},notes:'Management approves historical completion; actual costs later.',sites:[{orderNumber:'1/250',completionDate:'2026-10-14',overridePendingInstallation:false,evidence:[{row:4,invoice:'INV-1/250',siteName:'Evidence branch',installationText:'2026-10-14',section:'Submitted'}]}]};
  await assert.rejects(approveUpsRegisterCompletions(db.pool,atif,completion),/Management approval/);
  await assert.rejects(approveUpsRegisterCompletions(db.pool,actor,{...completion,sites:[{...completion.sites[0],orderNumber:'99/250'}]}),/existing order/);
  await assert.rejects(approveUpsRegisterCompletions(db.pool,actor,{...completion,sites:[{...completion.sites[0],evidence:[{...completion.sites[0].evidence[0],installationText:'installation pending'}]}]}),/explicit Management override/);
  assert.equal((await approveUpsRegisterCompletions(db.pool,actor,completion)).approved,1);
  assert.equal((await approveUpsRegisterCompletions(db.pool,actor,completion)).unchanged,1);
  const completed=await upsPortfolio(db.pool,actor,'UBL');
  assert.equal(completed.register.activeSites,2);assert.equal(completed.register.rows.filter(r=>r.status==='Approved closed').length,1);
  assert.equal(completed.actual.sites,1);assert.equal(completed.actual.sellingExGst,'762711.86');assert.equal(completed.actual.cost,null);assert.equal(completed.actual.markup,null);assert.equal(completed.actual.markupPercent,null);assert.equal(completed.actual.costPending,true);
  const operations=randomUUID();
  await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash)VALUES($1,$2,'Operations','Operations','isolated-only')",[operations,operations+'@test.invalid']);
  const accounts=randomUUID();
  await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash)VALUES($1,$2,'Accounts','Accounts','isolated-only')",[accounts,accounts+'@test.invalid']);
  const flags={programKey:'UPS:UBL:CHP-163',expectedVersion:2,notes:'Delivered; site not ready for installation.',sites:[{orderNumber:'2/250',reason:'Site not ready for installation',nextAction:'Confirm site readiness and schedule installation',followUpDate:null}]};
  await assert.rejects(flagUpsInstallations(db.pool,operations,flags),/Management approval/);
  await assert.rejects(upsInstallationAlerts(db.pool,atif),/Management, Operations or Accounts/);
  await assert.rejects(flagUpsInstallations(db.pool,actor,{...flags,expectedVersion:1}),/register changed/);
  await assert.rejects(flagUpsInstallations(db.pool,actor,{...flags,sites:[{...flags.sites[0],orderNumber:'1/250'}]}),/already approved closed/);
  await assert.rejects(flagUpsInstallations(db.pool,actor,{...flags,sites:[{...flags.sites[0],orderNumber:'99/250'}]}),/existing order/);
  assert.equal((await flagUpsInstallations(db.pool,actor,flags)).flagged,1);
  assert.equal((await flagUpsInstallations(db.pool,actor,flags)).unchanged,1);
  assert.equal((await upsInstallationAlerts(db.pool,accounts)).total,0,'Accounts sees only alerts assigned to Accounts');
  const alerts=await upsInstallationAlerts(db.pool,operations);
  assert.deepEqual(alerts,await upsInstallationAlerts(db.pool,actor));assert.equal(alerts.total,1);assert.equal(alerts.rows[0].orderNumber,'2/250');assert.equal(alerts.rows[0].followUpDate,null);
  assert.ok(!JSON.stringify(alerts).includes('unreviewedCosting'));assert.ok(!JSON.stringify(alerts).includes('sellingExGst'));
  const flagged=await upsPortfolio(db.pool,actor,'UBL');
  assert.equal(flagged.register.rows.find(r=>r.orderNumber==='2/250').status,'Delivered — installation pending');
  assert.deepEqual(flagged.budgeted,completed.budgeted);assert.deepEqual(flagged.actual,completed.actual);
  await assert.rejects(approveUpsRegisterCompletions(db.pool,actor,{...completion,expectedVersion:3,sites:[{...completion.sites[0],orderNumber:'2/250',overridePendingInstallation:true,evidence:[{...completion.sites[0].evidence[0],invoice:'INV-2/250'}]}]}),/unresolved installation alert/);
  const withDelivery={...flags,expectedVersion:3,sites:[{...flags.sites[0],deliveryDate:'2026-07-11',deliveryDateSource:'Recovery D118'}]};
  assert.equal((await flagUpsInstallations(db.pool,actor,withDelivery)).updated,1);
  assert.equal((await flagUpsInstallations(db.pool,actor,withDelivery)).unchanged,1);
  assert.equal((await upsInstallationAlerts(db.pool,operations)).rows[0].deliveryDate,'2026-07-11');
  const newRegister={...input('UBL','CHP-998',250)};
  await importUpsManagementRegister(db.pool,actor,newRegister);
  const accountsFlag={...flags,programKey:'UPS:UBL:CHP-998',expectedVersion:1,sites:[{...flags.sites[0],status:'Review needed by Accounts',responsibleDepartment:'Accounts',reason:'Conflicting installation evidence: completion date and pending note'},{...flags.sites[0],orderNumber:'1/250',status:'Further information required — documents awaited',responsibleDepartment:'Operations',reason:'Delivery or installation documents awaited; both stages unconfirmed'}]};
  await flagUpsInstallations(db.pool,actor,accountsFlag);
  assert.equal((await flagUpsInstallations(db.pool,actor,accountsFlag)).unchanged,2);
  const accountsAlerts=await upsInstallationAlerts(db.pool,accounts);assert.equal(accountsAlerts.total,1);assert.equal(accountsAlerts.rows[0].status,'Review needed by Accounts');assert.equal(accountsAlerts.rows[0].responsibleDepartment,'Accounts');
  assert.deepEqual(completed.budgeted,ubl.budgeted);assert.deepEqual(await fingerprint(),before,'Historical approvals do not invent IPOs, Accounts reports or actual expenses');

 }finally{await db.close();}
});


test('Operations boundary permits only the shared read-only alert list',async()=>{
 const boundary=workflowBoundary({} as any);
 async function check(role:string,method:string,url:string){let passed=false;await boundary({authSession:{user:{role}},method,originalUrl:url} as any,{} as any,()=>{passed=true;});return passed;}
 assert.equal(await check('Operations','GET','/api/director/ups-alerts'),true);
 assert.equal(await check('Accounts','GET','/api/director/ups-alerts'),true);
 for(const [role,method,url]of [['Operations','POST','/api/director/ups-alerts'],['Accounts','POST','/api/director/ups-alerts'],['Accounts','GET','/api/director/ups?customer=UBL'],['Operations','GET','/api/director/ups?customer=UBL'],['Inventory','GET','/api/director/ups-alerts'],['Design','GET','/api/director/ups-alerts']])await assert.rejects(check(role,method,url),/does not have access/);
});


test('Delivery age uses Karachi calendar days and leaves unknown dates blank',()=>{
 assert.equal(daysSinceDelivery('2026-07-11',new Date('2026-10-16T20:00:00Z')),98);
 assert.equal(daysSinceDelivery('2026-07-24',new Date('2026-10-16T20:00:00Z')),85);
 assert.equal(daysSinceDelivery('2026-10-17',new Date('2026-10-16T20:00:00Z')),0);
 assert.equal(daysSinceDelivery(null),null);assert.equal(daysSinceDelivery('2099-01-01'),null);
});

test('Historical actuals use the exact saved site cost, sum without duplication and preserve budgets and source rows',async()=>{
 const db=await testDatabase();try{
  const actor=randomUUID(),atif=randomUUID();
  for(const [id,role]of [[actor,'Management'],[atif,'Coordinator']])await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash)VALUES($1,$2,'Cost import test',$3,'isolated-only')",[id,id+'@test.invalid',role]);
  const sourceRows=[{sourceRow:13,values:[1,'INV-1/250',null,null,null,null,null,null,null,null,null,100.005]},{sourceRow:14,values:[2,'',null,null,null,null,null,null,null,null,null,200.115]}];
  const register={...input(),unreviewedCosting:{status:'Unreviewed',analysisRows:sourceRows,ledgerTransactions:[],sourceFiles:[],notes:'Original imported costing'}};
  await importUpsManagementRegister(db.pool,actor,register);
  const before=await upsPortfolio(db.pool,actor,'UBL');
  const evidence={programKey:'UPS:UBL:CHP-163',expectedVersion:1,source:{fileId:'recovery',filename:'Recovery.xlsx',sha256:'b'.repeat(64),sheet:'UBL Chint',url:'https://docs.google.com/spreadsheets/d/recovery'},notes:'Director requests completed site actuals',sites:[{orderNumber:'1/250',completionDate:'2026-10-14',overridePendingInstallation:false,evidence:[{row:4,invoice:'INV-1/250',siteName:'Branch',installationText:'2026-10-14',section:'Submitted'}]}]};
  await approveUpsRegisterCompletions(db.pool,actor,evidence);
  const costSource={...register.source,sheet:register.sourceSheet,column:'L'};
  const withCost={...evidence,expectedVersion:2,costSource,sites:[{...evidence.sites[0],actualCost:{amount:'100.01',sourceRow:13}}]};
  await assert.rejects(approveUpsRegisterCompletions(db.pool,atif,withCost),/Management approval/);
  await assert.rejects(approveUpsRegisterCompletions(db.pool,actor,{...withCost,costSource:{...costSource,sha256:'c'.repeat(64)}}),/source does not match/);
  await assert.rejects(approveUpsRegisterCompletions(db.pool,actor,{...withCost,sites:[{...withCost.sites[0],actualCost:{amount:'100.00',sourceRow:13}}]}),/differs from the saved/);
  await assert.rejects(approveUpsRegisterCompletions(db.pool,actor,{...withCost,sites:[{...withCost.sites[0],actualCost:{amount:'200.12',sourceRow:14}}]}),/must match the site row/);
  await assert.rejects(approveUpsRegisterCompletions(db.pool,actor,{...withCost,sites:evidence.sites}),/Each actual cost needs/);
  await approveUpsRegisterCompletions(db.pool,actor,withCost);
  let actual=await upsPortfolio(db.pool,actor,'UBL');assert.equal(actual.actual.sites,1);assert.equal(actual.actual.cost,'100.01');assert.equal(actual.actual.costPending,false);assert.deepEqual(actual.budgeted,before.budgeted);
  const both={...withCost,expectedVersion:3,sites:[withCost.sites[0],{...evidence.sites[0],orderNumber:'2/250',actualCost:{amount:'200.12',sourceRow:14},evidence:[{...evidence.sites[0].evidence[0],invoice:'INV-2/250'}]}]};
  assert.equal((await approveUpsRegisterCompletions(db.pool,actor,both)).approved,1);assert.equal((await approveUpsRegisterCompletions(db.pool,actor,both)).unchanged,2);
  actual=await upsPortfolio(db.pool,actor,'UBL');assert.equal(actual.actual.sites,2);assert.equal(actual.actual.cost,'300.13');assert.equal(actual.actual.costPending,false);assert.equal(actual.actual.markup,new Decimal(actual.actual.sellingExGst!).sub('300.13').toFixed(2));assert.equal(actual.actual.markupPercent,new Decimal(actual.actual.markup!).div('300.13').mul(100).toFixed(2));assert.deepEqual(actual.budgeted,before.budgeted);
  const latest=(await db.pool.query('SELECT snapshot FROM ups_management_program_versions ORDER BY version DESC LIMIT 1')).rows[0].snapshot.managementRegister;
  assert.deepEqual(latest.unreviewedCosting.analysisRows,sourceRows);assert.equal(latest.completionApprovals['1/250'].actualCostEvidence.cell,'L13');assert.equal(latest.completionApprovals['1/250'].actualCostEvidence.rawValue,'100.005');
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM internal_purchase_orders')).rows[0].n,0);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM accounts_job_closures')).rows[0].n,0);
 }finally{await db.close();}
});

test('issued order outside the historical import remains in progress totals without assumed delivery or completion',()=>{
 const p={...input('MBL','CHP-338',60),sites:[{orderNumber:'1/60',siteName:'Imported site'}]};
 const r=upsActiveRegister([{program_key:'UPS:MBL:CHP-338',version:1,snapshot:{managementRegister:p}}],[{id:'real-issued',number:'CHP-338',orderNumber:'20/60',configuration:'6-5',site:'Consumer Hub',issuedAt:'2026-10-17T00:00:00Z'}],['6-5','6-10']);
 assert.equal(r.activeSites,2);assert.equal(r.programs[0].progressSummary.listedSites,2);assert.equal(r.programs[0].progressSummary.unverified,2);assert.equal(r.programs[0].progressSummary.awaitingDeliveryAgeing.length,0);assert.equal(r.programs[0].progressSummary.completed,0);assert.equal(r.programs[0].remainingSites,58);
});
