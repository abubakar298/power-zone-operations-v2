import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';import {ProjectWorkflowRepository} from '../server/project-workflow/repository.js';
import {ublProgrammeLinks,solarWorkflow,withProgrammeAccounts} from '../server/ubl/programme-links.js';import {UblRepository} from '../server/ubl/repository.js';
import {ProjectCheckpointsRepository} from '../server/projects/repository.js';
test('UBL Solar programme follows a real new survey request through immutable issuance, QC progress and native job closure automatically',async()=>{
 const db=await testDatabase();try{
 const actor=randomUUID(),owner=randomUUID();for(const [id,role] of [[actor,'Coordinator'],[owner,'Admin']])await db.pool.query('INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role,'fixture',role]);
 const framework=(await db.pool.query("SELECT id FROM project_framework_current WHERE customer_id=5 AND configuration_key='25-20-30:Revised'")).rows[0].id;
 const repo=new ProjectWorkflowRepository(db.pool),created=await repo.create(actor,{requestKey:randomUUID(),customerId:5,siteName:'Programme automatic linkage fixture',siteCode:'AUTO-SOLAR',route:'survey-framework',frameworkId:framework,notes:'Synthetic survey to closure test'});
 let link=(await ublProgrammeLinks(db.pool)).find(l=>l.workflowId===created.id);assert.ok(link);assert.equal(link.jobKey,'workflow:'+created.id);assert.equal(link.configuration,'25-20-30');assert.equal(link.status,'Pre-IPO');assert.equal(link.ipoId,null);
 const ubl=new UblRepository(db.pool);assert.ok((await ubl.sites(owner)).some(s=>s.job_key===link.jobKey&&s.baseline===null));
 assert.ok((await new ProjectCheckpointsRepository(db.pool).list(owner)).some(s=>s.key===link.jobKey&&s.programme==='UBL Solar 70'));
 // Use the normal direct-framework receipt journey for the same saved request identity.
 await db.pool.query("UPDATE project_workflow_records SET route='direct-framework',stage='po_receipt' WHERE id=$1",[created.id]);
 const original=(await db.pool.query('SELECT data FROM project_workflow_records WHERE id=$1',[created.id])).rows[0].data.basis;
 const evidence=await repo.attach(actor,created.id,{kind:'PO / confirmation',filename:'fixture.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4\n% synthetic\n%%EOF').toString('base64')});
 const detail=await repo.detail(actor,created.id);await repo.action(actor,created.id,{version:detail.record.version,requestKey:randomUUID(),action:'receipt',input:{reference:'AUTO-SOLAR-PO',date:'2026-11-02',evidenceId:evidence.id,basisType:'framework',frameworkId:framework,confirmationType:'Customer PO',actual:original.comparison,reviewed:true,notes:'Synthetic approved receipt',saleDetails:{invoiceCompany:'PZES (PVT Ltd)',salesPerson:'Atif',paymentMode:'Bank transfer'}}});
 const issued=(await db.pool.query('SELECT ipo_id FROM project_workflow_issuances WHERE record_id=$1',[created.id])).rows[0];
 const {AccountsSourceRegisters}=await import('../server/accounts/source-registers.js');const {managementProgrammes}=await import('../server/director/management-programmes.js');
 await new AccountsSourceRegisters(db.pool).import(owner,{sourceDate:'2026-11-02',manifest:[{name:'Empty reviewed fixture',sha256:'a'.repeat(64)}],registers:[{rows:[]}],cables:{rows:[]},internet:{rows:[]},sites:{rows:[]},evidence:{rows:[],cableStageAdjustments:[]}},0);
 const programme=(await managementProgrammes(db.pool,owner)).programmes.find(p=>p.key==='ubl-solar-70')!;assert.equal(programme.rows.filter(r=>r.ipo).length,1);assert.equal(programme.rows[0].site,'Programme automatic linkage fixture');assert.equal(programme.rows[0].grossContract,original.order.allocation.total);

 link=(await ublProgrammeLinks(db.pool)).find(l=>l.workflowId===created.id);assert.equal(link.jobKey,'ipo:'+issued.ipo_id);assert.equal(link.status,'Active');
 assert.equal((await ublProgrammeLinks(db.pool)).filter(l=>l.workflowId===created.id).length,1);assert.equal((await ubl.sites(owner)).filter(s=>s.workflow_record_id===created.id).length,1);
 const existing=(await db.pool.query("SELECT b.site_id,b.version FROM operations_board_versions b WHERE b.snapshot#>>'{origin,ipoId}'=$1 ORDER BY b.version DESC LIMIT 1",[issued.ipo_id])).rows[0];assert.ok(existing);
 const board=existing.site_id;await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,$2,$3,'qc','Synthetic complete',$4,$5)",[board,existing.version+1,{origin:{ipoId:issued.ipo_id},stage:'delivered',completed:true,deliveryDate:'2026-11-01',qc:{handover:{date:'2026-11-02'}}},randomUUID(),owner]);
 const checkpoints=await new ProjectCheckpointsRepository(db.pool).list(owner),job=checkpoints.find(s=>s.key===link.jobKey)!;assert.equal(job.operation.installationStatus,'Installation completed');assert.equal(job.operation.completionDate,'2026-11-02');assert.ok(job.agreedTotal);assert.equal(job.configuration,'25-20-30');
 const report=randomUUID(),reportVersion=randomUUID();await db.pool.query('INSERT INTO inventory_reports(id,job_key,created_by) VALUES($1,$2,$3)',[report,link.jobKey,owner]);await db.pool.query("INSERT INTO inventory_report_versions(id,report_id,version,stage,snapshot,request_key,created_by) VALUES($1,$2,1,'Sent to Accounts','{}',$3,$4)",[reportVersion,report,randomUUID(),owner]);
 await db.pool.query("INSERT INTO accounts_job_closures(id,job_key,report_version_id,version,stage,snapshot,request_key,created_by) VALUES($1,$2,$3,1,'Closed',$4,$5,$6)",[randomUUID(),link.jobKey,reportVersion,{summary:{selling:'100',actual:'80',budgetedMarkup:'10',budgetedMarkupPercent:'10',actualMarkup:'20',actualMarkupPercent:'25'}},randomUUID(),owner]);
 assert.ok((await ubl.closedJobs(owner)).jobs.some(s=>s.jobKey===link.jobKey&&s.configuration==='25-20-30'));
 assert.equal((await db.pool.query('SELECT count(*) n FROM internal_purchase_orders')).rows[0].n,'1');assert.equal((await db.pool.query('SELECT count(*) n FROM ubl_site_orders')).rows[0].n,'38');
 }finally{await db.close();}
});
test('programme membership never absorbs BESS-only, UPS, other customers or archived requests',()=>{
 const row={customer_code:'UBL',framework_type:'ubl-solar',data:{}};assert.equal(solarWorkflow(row),true);
 for(const change of [{customer_code:'MBL'},{family:'bess-only'},{framework_type:'bank-ups'},{data:{localPreviewArchived:true}}])assert.equal(solarWorkflow({...row,...change}),false);
 assert.equal(solarWorkflow({customer_code:'UBL',data:{},framework_type:null}),false);
});

test('future issued programme sites join Accounts automatically without inventing invoices or replacing reviewed financials',()=>{
 const l={jobKey:'ipo:native',ipoId:'native',ipo:'CHP-901',status:'Active',siteName:'Solar fixture',siteCode:'901',poNumber:'PO-901',agreedTotal:'5000000',flags:[],workflowId:'workflow'};
 const source={registers:[],sites:{rows:[]}},before=JSON.stringify(source),s=withProgrammeAccounts(source,[l]);assert.equal(s.sites.rows.length,1);assert.equal(s.registers[0].rows[0].key,'UBL:SOLAR:901');assert.equal(s.registers[0].rows[0].advance.invoiceAmount,null);assert.equal(s.registers[0].rows[0].advance.received,false);assert.equal(JSON.stringify(source),before);
 const original={...s.registers[0].rows[0],advance:{invoiceAmount:'123.00',submitted:true,received:true}},reviewed={registers:[{rows:[original]}],sites:{rows:[original]}};
 const retained=withProgrammeAccounts(reviewed,[l]);assert.equal(retained.registers.length,1);assert.deepEqual(retained.registers[0].rows[0],original);assert.equal(retained.sites.rows.length,1);
 assert.equal(withProgrammeAccounts(source,[{...l,status:'Pre-IPO',ipoId:null}]).sites.rows.length,0);
});
