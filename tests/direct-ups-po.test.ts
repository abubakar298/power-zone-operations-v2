import {AccountsRepository} from '../server/accounts/repository.js';
import {upsPortfolio,saveUpsManagementBudget} from '../server/director/ups-portfolio.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {testDatabase} from './database.js';
import {ProjectWorkflowRepository} from '../server/project-workflow/repository.js';
import {OrdersRepository} from '../server/orders/repository.js';
import {ptDisplayRows} from '../server/orders/pt-detail.js';
import {directPoSuggestions} from '../shared/direct-po-reading.js';
import {manualIpoAvailable} from '../server/documents/manual-ipo.js';

test('Direct UPS PO uses correct LV configuration, four proportional PT phases, manual number uniqueness and immutable accepted totals',async()=>{
 const previous=process.env.ENABLE_DEFERRED_UPS_WORKFLOW;process.env.ENABLE_DEFERRED_UPS_WORKFLOW='true';
 const db=await testDatabase();
 try{
  const actor=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Atif test','Coordinator','isolated-only')",[actor,actor+'@test.invalid']);
  const repo=new ProjectWorkflowRepository(db.pool),orders=new OrdersRepository(db.pool);
  const referenceFramework=(await db.pool.query("SELECT id FROM project_framework_current WHERE configuration_key='MBL-UPS-6-5'")).rows[0];
  const referenceId=randomUUID(),referenceBytes=Buffer.from('%PDF-1.4 reference-only');
  await db.pool.query('INSERT INTO framework_reference_attachments(id,framework_id,filename,mime,content,sha256,summary,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[referenceId,referenceFramework.id,'60 Units.pdf','application/pdf',referenceBytes,createHash('sha256').update(referenceBytes).digest('hex'),{quantity:60,purpose:'reference'},actor]);
  const refs=await repo.references(actor);
  assert.equal(refs.frameworkAttachments[0].framework_id,referenceFramework.id);
  assert.ok((await repo.frameworkReferenceAttachment(actor,referenceId)).content.equals(referenceBytes));
  assert.equal((await db.pool.query('SELECT count(*) AS n FROM project_workflow_records')).rows[0].n,'0');
  const accountsActor=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Accounts test','Accounts','isolated-only')",[accountsActor,accountsActor+'@test.invalid']);
  const accounts=new AccountsRepository(db.pool);
  const director=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Director test','Management','isolated-only')",[director,director+'@test.invalid']);
  assert.equal((await upsPortfolio(db.pool,director,'MBL')).rows.length,0);
  await assert.rejects(upsPortfolio(db.pool,actor,'MBL'),/management access/);
 const expected=[['MBL-UPS-6-5','660000.00','1'],['MBL-UPS-6-10','935000.00','2'],['UBL-UPS-6-10','900000.00','2']];
  for(let n=0;n<expected.length;n++){
   const [key,gross,batteries]=expected[n];
   const f=(await db.pool.query('SELECT * FROM project_framework_current WHERE configuration_key=$1',[key])).rows[0];assert.ok(f);
   const record=await repo.create(actor,{requestKey:randomUUID(),customerId:f.customer_id,siteName:'Disposable UPS branch '+n,siteCode:'UPS-TEST-'+n,route:'direct-framework',frameworkId:f.id,notes:'Isolated Direct PO test'});
   let detail=await repo.detail(actor,record.id);
   const basis=(await db.pool.query('SELECT data FROM project_workflow_records WHERE id=$1',[record.id])).rows[0].data.basis;
   assert.equal(basis.order.allocation.total,gross);
   assert.equal(basis.boq.lines.find((l:any)=>l.itemId==='CH-BAT-LV-05 KW').qty,batteries);
   assert.ok(basis.boq.lines.some((l:any)=>l.itemId==='CH-BMS-LV'));
   assert.ok(!basis.boq.lines.some((l:any)=>/CH-BAT-HV|CH-BMS-HV/.test(l.itemId)));
   const file=await repo.attach(actor,record.id,{kind:'PO / confirmation',filename:n===0?'email-approval.png':'UPS-PO.pdf',mime:n===0?'image/png':'application/pdf',base64:n===0?'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=':Buffer.from('%PDF-1.4 isolated-test-evidence').toString('base64')});
   if(n===0){
    const extracted=directPoSuggestions('Branch code: UPS-TEST-0\nBranch name: Evidence branch');
    const values={...extracted,siteCode:'UPS-TEST-0',siteName:'Corrected branch',approvalDate:'2026-10-15',orderNumber:'20/60',ipoNumber:'CHP-UPS-TEST-0'};
    const saveAttempt=(patch:any)=>repo.action(actor,record.id,{version:detail.record.version,requestKey:randomUUID(),action:'save-direct-po-details',input:{evidenceId:file.id,evidenceType:'Email approval',extracted,values,notes:'Validation',...patch}});
    await assert.rejects(saveAttempt({evidenceId:randomUUID()}),/Attach PO/);
    await assert.rejects(saveAttempt({values:{...values,siteCode:'OTHER'}}),/branch code/);
    await assert.rejects(saveAttempt({values:{...values,orderNumber:'61/60'}}),/unit number/);
    await repo.action(actor,record.id,{version:detail.record.version,requestKey:randomUUID(),action:'save-direct-po-details',input:{evidenceId:file.id,evidenceType:'Email approval',extracted,sourceText:'Approved lithium system\u0000 archived text',values,notes:'Review source and corrections'}});
    detail=await repo.detail(actor,record.id);
    assert.equal(detail.record.data.directPoDetails.sourceText,'Approved lithium system archived text');assert.equal(detail.record.data.directPoDetails.history[0].actor,actor);assert.equal(detail.record.data.directPoDetails.extracted.siteName,'Evidence branch');assert.equal(detail.record.data.directPoDetails.values.siteName,'Corrected branch');
    const updated={...values,siteContact:'Corrected contact'};
    await repo.action(actor,record.id,{version:detail.record.version,requestKey:randomUUID(),action:'save-direct-po-details',input:{evidenceId:file.id,evidenceType:'Email approval',extracted,values:updated,notes:'Second correction'}});
    const stale=detail.record.version;detail=await repo.detail(actor,record.id);assert.equal(detail.record.data.directPoDetails.history.length,2);assert.equal(detail.record.data.directPoDetails.history[1].changes[0].field,'siteContact');const events=(await db.pool.query("SELECT snapshot FROM project_workflow_events WHERE record_id=$1 AND action='save-direct-po-details' ORDER BY version",[record.id])).rows;assert.equal(events.length,2);assert.equal(events[0].snapshot.data.directPoDetails.history.length,1);assert.equal(events[0].snapshot.data.directPoDetails.values.siteContact,'');
    await assert.rejects(repo.action(actor,record.id,{version:stale,requestKey:randomUUID(),action:'save-direct-po-details',input:{evidenceId:file.id,evidenceType:'Email approval',extracted,values,notes:'stale'}}),/changed/);
   }
   const input={reference:'DIRECT-UPS-PO-'+n,date:'2026-10-15',evidenceId:file.id,basisType:'framework',frameworkId:f.id,ipoNumber:'CHP-UPS-TEST-'+n,actual:n===0?undefined:basis.comparison,confirmationType:n===0?'Email approval':'Customer PO',saleDetails:{orderNumber:n===0?'20/60':'',invoiceCompany:'PZES (PVT Ltd)',salesPerson:'Waqas ul Haq',evidenceNotes:'Isolated test'},reviewed:true,notes:'Exact accepted agreement'};
   if(n>0)await assert.rejects(repo.salePreview(actor,record.id,{...input,ipoNumber:"CHP-UPS-TEST-0"}),/already in use/);
   if(n===2)await assert.rejects(repo.salePreview(actor,record.id,{...input,confirmationType:'Email approval',actual:undefined}),/Meezan Direct PO/);
   if(n===1){const emailDraft=await repo.salePreview(actor,record.id,{...input,confirmationType:'Email approval',actual:undefined});assert.equal(emailDraft.input.evidenceType,'Email approval');assert.equal(emailDraft.input.poNumber,'');assert.equal(emailDraft.allocation.total,gross);}
   const draft=await repo.salePreview(actor,record.id,input);
   assert.equal(draft.input.evidenceType,input.confirmationType);if(n===0){assert.equal(draft.input.orderNumber,'20/60');assert.equal(draft.siteName,'Corrected branch');}
   if(n===0){assert.equal(draft.input.poNumber,'');assert.equal(draft.input.workflowEvidenceId,file.id);}
   const phases=ptDisplayRows(draft.peachtree);
   assert.deepEqual(phases.map((p:any)=>p.name),['Inverter','Batteries','BMS','Installations']);assert.equal(phases[3].itemId,'CH-Installations');
   assert.ok(draft.allocation.lines[0].description.includes((batteries==='1'?'5':'10')+' kWh'));
   assert.equal(phases.reduce((s:Decimal,p:any)=>s.plus(p.amount),new Decimal(0)).plus(draft.peachtree.ipoTax).toFixed(2),gross);
   // The same cost share determines each net selling amount; GST is not margin.
   const inverterCost=new Decimal(basis.boq.lines.find((l:any)=>l.itemId==='CH-PCS-HYB-SP-006').total);
   assert.equal(new Decimal(basis.order.allocation.subtotal).mul(inverterCost).div(basis.boq.total).toFixed(2),phases[0].amount);
   await repo.action(actor,record.id,{version:detail.record.version,requestKey:randomUUID(),action:'receipt',input});
   const ipo=(await db.pool.query('SELECT * FROM internal_purchase_orders WHERE number=$1',[input.ipoNumber])).rows[0];assert.ok(ipo);assert.equal(ipo.snapshot.allocation.total,gross);assert.equal(ptDisplayRows(ipo.snapshot.peachtree).length,4);
   const accountComparison=await accounts.comparison(accountsActor,ipo.id);
   assert.equal(accountComparison.quotation,undefined);assert.equal(accountComparison.agreement.number,key);assert.equal(accountComparison.agreement.total,gross);assert.equal(accountComparison.reconciles,true);assert.equal(accountComparison.approvedBasisLabel,'approved agreement');
   await assert.rejects(accounts.comparison(actor,ipo.id),/Accounts access/);
   if(n===0){
    const client=await db.pool.connect();try{await client.query('BEGIN');await client.query('ALTER TABLE internal_purchase_orders DISABLE TRIGGER USER');
     const checked=new AccountsRepository(client as any);
     for(const [path,value] of [[['allocation','total'],'1.00'],[['peachtree','phases','0','amount'],'1.00'],[['approvedCommercialSource','key'],'WRONG-AGREEMENT']]){
      await client.query('UPDATE internal_purchase_orders SET snapshot=$2 WHERE id=$1',[ipo.id,ipo.snapshot]);
      await client.query('UPDATE internal_purchase_orders SET snapshot=jsonb_set(snapshot,$2::text[],$3::jsonb) WHERE id=$1',[ipo.id,path,JSON.stringify(value)]);
      assert.equal((await checked.comparison(accountsActor,ipo.id)).reconciles,false);
      await assert.rejects(checked.review(accountsActor,{id:ipo.id,version:0,decision:'Verified',notes:'Must reject invalid basis/totals',requestKey:randomUUID()}),/do not reconcile/);
     }
    }finally{await client.query('ROLLBACK');client.release();}
   }
   const accountReview=await accounts.review(accountsActor,{id:ipo.id,version:0,decision:'Verified',notes:'Approved agreement and IPO/PT checked',requestKey:randomUUID()});assert.equal(accountReview.snapshot.agreementId,f.id);
   const bank=key.startsWith('MBL')?'MBL':'UBL';const portfolio=await upsPortfolio(db.pool,director,bank);const listed=portfolio.rows.find(r=>r.id===ipo.id);assert.ok(listed,'Confirmed UPS appears without any Accounts approval action');assert.equal(listed.number,input.ipoNumber);assert.equal(listed.payable,gross);assert.equal(listed.budgetedCost,new Decimal(basis.boq.total).toFixed(2));assert.equal(portfolio.rows.filter(r=>r.id===ipo.id).length,1);
   if(n===0){const frozen=JSON.stringify(ipo.snapshot),rates={'CH-PCS-HYB-SP-006':'213000','CH-BMS-LV':'80000','CH-BAT-LV-05 KW':'187000'};const budget=await saveUpsManagementBudget(db.pool,director,ipo.id,rates,'Director revised budget');assert.equal((await saveUpsManagementBudget(db.pool,director,ipo.id,rates,'Same values')).version,1);const updated=(await upsPortfolio(db.pool,director,'MBL')).rows.find(r=>r.id===ipo.id)!;assert.equal(updated.budgetedCost,budget.snapshot.total);assert.equal(JSON.stringify((await db.pool.query('SELECT snapshot FROM internal_purchase_orders WHERE id=$1',[ipo.id])).rows[0].snapshot),frozen);assert.equal((await upsPortfolio(db.pool,director,'MBL')).actual.sites,0);}
assert.ok(!portfolio.rows.some(r=>r.configuration!== '6-5' && r.configuration!=='6-10'));
   if(n===2)assert.equal((await upsPortfolio(db.pool,director,'MBL')).rows.length,2,'UBL issue does not leak into MBL portfolio');
   const loaded=await orders.get(ipo.id);assert.equal(loaded.snapshot.input.poNumber,n===0?'':input.reference);assert.equal(loaded.snapshot.input.evidenceType,input.confirmationType);if(n===0){assert.equal(loaded.snapshot.input.orderNumber,'20/60');assert.equal(loaded.snapshot.siteName,'Corrected branch');assert.equal(loaded.snapshot.directPoApproval.history.length,2);}assert.equal(loaded.snapshot.input.approvalReference,input.reference);
   assert.equal(await manualIpoAvailable(db.pool,input.ipoNumber),false);
   await assert.rejects(repo.salePreview(actor,record.id,{...input,ipoNumber:input.ipoNumber}),/preview-only/);
  }
  const program={totalSites:60,configurationKeys:['MBL-UPS-6-5']};
  await db.pool.query('INSERT INTO ups_management_program_versions(id,program_key,version,customer_code,snapshot,notes,created_by)VALUES($1,$2,1,$3,$4,$5,$6)',[randomUUID(),'MBL-60','MBL',program,'Test 60-unit order',director]);
  const programPortfolio=await upsPortfolio(db.pool,director,'MBL');assert.equal(programPortfolio.program.totalSites,60);assert.equal(programPortfolio.rows.length,1,'Only received IPOs of this60-unit agreement count');assert.equal(programPortfolio.actual.sites,0);assert.equal(programPortfolio.actual.cost,null);
  const ipoId=programPortfolio.rows[0].id,reportId=randomUUID(),reportVersion=randomUUID(),job='ipo:'+ipoId;
  await db.pool.query('INSERT INTO inventory_reports(id,job_key,created_by)VALUES($1,$2,$3)',[reportId,job,director]);
  await db.pool.query('INSERT INTO inventory_report_versions(id,report_id,version,stage,snapshot,request_key,created_by)VALUES($1,$2,1,$3,$4,$5,$6)',[reportVersion,reportId,'Sent to Accounts',{},randomUUID(),director]);
  const actual={summary:{selling:'559322.03',actual:'480000.00'}};
  await db.pool.query('INSERT INTO accounts_job_closures(id,job_key,report_version_id,version,stage,snapshot,request_key,created_by)VALUES($1,$2,$3,1,$4,$5,$6,$7)',[randomUUID(),job,reportVersion,'Awaiting Management',actual,randomUUID(),director]);
  assert.equal((await upsPortfolio(db.pool,director,'MBL')).actual.sites,0,'Unapproved job closure must not count');
  await db.pool.query('INSERT INTO accounts_job_closures(id,job_key,report_version_id,version,stage,snapshot,request_key,created_by)VALUES($1,$2,$3,2,$4,$5,$6,$7)',[randomUUID(),job,reportVersion,'Closed',actual,randomUUID(),director]);
  const complete=(await upsPortfolio(db.pool,director,'MBL')).actual;assert.equal(complete.sites,1);assert.equal(complete.cost,'480000.00');assert.equal(complete.markup,'79322.03');
  assert.equal(await manualIpoAvailable(db.pool,'298'),false); // original UBL IPO retained
 }finally{await db.close();if(previous===undefined)delete process.env.ENABLE_DEFERRED_UPS_WORKFLOW;else process.env.ENABLE_DEFERRED_UPS_WORKFLOW=previous;}
});


test('production defaults hide and reject deferred Direct UPS creation without changing existing solar routes',async()=>{
 const previous=process.env.ENABLE_DEFERRED_UPS_WORKFLOW;delete process.env.ENABLE_DEFERRED_UPS_WORKFLOW;
 const db=await testDatabase();try{
 const actor=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Atif test','Coordinator','isolated-only')",[actor,actor+'@test.invalid']);
 const repo=new ProjectWorkflowRepository(db.pool),f=(await db.pool.query("SELECT * FROM project_framework_current WHERE configuration_key='MBL-UPS-6-5'")).rows[0];
 const refs=await repo.references(actor);assert.equal(refs.features.directPoUps,false);assert.ok(!refs.frameworks.some((x:any)=>x.type==='bank-ups'));
 await assert.rejects(repo.create(actor,{requestKey:randomUUID(),customerId:f.customer_id,siteName:'Deferred fixture',siteCode:'UPS-DEFERRED',notes:'Deferred release fixture',route:'direct-framework',frameworkId:f.id}),/deferred/);
 assert.equal((await db.pool.query("SELECT count(*) AS n FROM project_workflow_records")).rows[0].n,'0');
 }finally{await db.close();if(previous===undefined)delete process.env.ENABLE_DEFERRED_UPS_WORKFLOW;else process.env.ENABLE_DEFERRED_UPS_WORKFLOW=previous;}
});

test('0999 permits separate construction sites while other codes and same-site active work remain unique',async()=>{
 const previous=process.env.ENABLE_DEFERRED_UPS_WORKFLOW;process.env.ENABLE_DEFERRED_UPS_WORKFLOW='true';const db=await testDatabase();
 try{
 const actor=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Atif shared-code test','Coordinator','isolated-only')",[actor,actor+'@test.invalid']);
 const repo=new ProjectWorkflowRepository(db.pool),f=(await db.pool.query("SELECT * FROM project_framework_current WHERE configuration_key='UBL-UPS-6-10'")).rows[0];
 const make=(name:string,code:string,address:string)=>repo.create(actor,{requestKey:randomUUID(),customerId:f.customer_id,siteName:name,siteCode:code,siteAddress:address,route:'direct-framework',frameworkId:f.id,notes:'Isolated shared placeholder regression'});
 const a=await make('Sardheri, Charsadda','0999','Sardheri address'),b=await make('Other construction branch','0999','Other address');
 const rows=(await db.pool.query('SELECT site_id,site_code FROM project_workflow_records WHERE id=ANY($1::uuid[])',[[a.id,b.id]])).rows;
 assert.equal(rows.length,2);assert.notEqual(rows[0].site_id,rows[1].site_id);assert.ok(rows.every((r:any)=>r.site_code==='0999'));
 await assert.rejects(make('Sardheri, Charsadda','0999','Sardheri address'),/already has active work/);
 for(const code of ['0208','0000']){await make('Ordinary branch '+code,code,'First address');await assert.rejects(make('Another branch '+code,code,'Other address'),/already has active work/);}
 const m=(await db.pool.query("SELECT * FROM project_framework_current WHERE configuration_key='MBL-UPS-6-5'")).rows[0];
 const mbl=(name:string)=>repo.create(actor,{requestKey:randomUUID(),customerId:m.customer_id,siteName:name,siteCode:'0999',siteAddress:name,route:'direct-framework',frameworkId:m.id,notes:'Only UBL UPS shares code'});await mbl('Meezan A');await assert.rejects(mbl('Meezan B'),/already has active work/);
 }finally{await db.close();if(previous===undefined)delete process.env.ENABLE_DEFERRED_UPS_WORKFLOW;else process.env.ENABLE_DEFERRED_UPS_WORKFLOW=previous;}
});
