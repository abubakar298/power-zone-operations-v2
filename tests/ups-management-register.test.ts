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
  assert.deepEqual(await fingerprint(),before,'All existing master, workflow, document, budget, closure and counter data remain untouched');
  const latest=(await db.pool.query('SELECT program_key,version,snapshot FROM ups_management_program_versions')).rows;
  const issued=[{id:'real-ipo',number:'CHP-338',orderNumber:'1/60',configuration:'6-5',site:'Real branch',siteCode:'0208'},{id:'existing20',number:'CHP-338',orderNumber:'20/60',configuration:'6-5',site:'Consumer Hub Lahore',siteCode:'code'}];
  const register=upsActiveRegister(latest.filter(p=>p.snapshot.managementRegister.customer==='MBL'),issued);
  assert.equal(register.activeSites,7);assert.equal(register.rows.filter(r=>r.ipoId==='real-ipo').length,1);assert.equal(register.rows.find(r=>r.ipoId==='real-ipo').site,'Real branch');
  assert.equal(register.programs.find(p=>p.projectReference==='CHP-338')!.activeSites,3);assert.equal(register.rows.filter(r=>r.ipoId==='existing20').length,1);
 }finally{await db.close();}
});
