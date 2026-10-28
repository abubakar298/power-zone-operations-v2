import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {OperationsRepository} from '../server/operations/repository.js';
import {ProjectWorkflowRepository} from '../server/project-workflow/repository.js';
import {SiteWorkflowRepository} from '../server/site-workflow/repository.js';
import {MaterialDraftRepository} from '../server/inventory/material-drafts.js';
import {linkCreatedOperationsMaterialSource,approvedMaterialIdentity} from '../server/inventory/source-links.js';
import {transaction} from '../server/db/transaction.js';
import {syncCreatedOperationsHandoff} from '../server/operations-board/live-ipo-sync.js';

test('normal Operations issue appends its exact receiving queue atomically, retries preserve decisions and historical sources are excluded',async()=>{
 const db=await testDatabase();try{
  const actor=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'SIMULATION handoff','test-only','Coordinator')",[actor,actor+'@handoff.invalid']);
  let index=0;
  async function ipo(historical=false,poOverride?:string){
   const n=++index,siteId=(await db.pool.query('SELECT COALESCE(max(id),0)+1 AS id FROM sites')).rows[0].id;
   const draft=randomUUID(),boq=randomUUID(),revision=randomUUID(),po=randomUUID(),id=randomUUID();
   await db.pool.query("INSERT INTO sites(id,customer_id,name,code,location,status) VALUES($1,1,$2,$3,'Lahore','Active')",[siteId,'SIMULATION handoff '+n,'QH'+n]);
   await db.pool.query("INSERT INTO survey_drafts(id,owner_id,inputs) VALUES($1,$2,'{}')",[draft,actor]);
   await db.pool.query('INSERT INTO boqs(id,draft_id,site_id,customer_id,sequence,created_by) VALUES($1,$2,$3,1,$4,$5)',[boq,draft,siteId,n,actor]);
   await db.pool.query('INSERT INTO boq_revisions(id,boq_id,revision,number,snapshot,created_by) VALUES($1,$2,0,$3,$4,$5)',[revision,boq,'SIMULATION-BOQ-'+n,{survey:{customerId:1,siteCode:'QH'+n,family:'solar-hybrid'},lines:[],total:'100.00'},actor]);
   await db.pool.query("INSERT INTO customer_purchase_orders(id,customer_id,po_number,input,created_by) VALUES($1,1,$2,'{}',$3)",[po,'SIMULATION-PO-'+n,actor]);
   const snapshot={siteName:'SIMULATION handoff '+n,siteCode:'QH'+n,boqRevisionId:revision,input:{poNumber:poOverride??'SIMULATION-PO-'+n},allocation:{total:'100.00'},...(historical?{historicalImport:{kind:'verified-register-import'}}:{})};
   await db.pool.query('INSERT INTO internal_purchase_orders(id,customer_po_id,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,po,'SIMULATION-IPO-'+n,snapshot,'b'.repeat(64),randomUUID(),actor]);return {id,snapshot};
  }
  const repo=new OperationsRepository(db.pool),fresh=await ipo(),other=await ipo();
  const protectedBefore=(await db.pool.query("SELECT (SELECT md5(string_agg(snapshot::text,'' ORDER BY id)) FROM internal_purchase_orders) ipo,(SELECT count(*) FROM accounts_pt_entries) pt,(SELECT count(*) FROM accounts_job_closures) closures,(SELECT count(*) FROM inventory_warehouse_operational_movements) movements,(SELECT count(*) FROM stock_on_hand_entries) stock")).rows[0];
  const input={ipoId:fresh.id,notes:'SIMULATION normal handoff',requestKey:randomUUID()},issued=await repo.issue(actor,input),boardId='live-ipo:'+fresh.id;
  const board=(await db.pool.query('SELECT snapshot FROM operations_board_versions WHERE site_id=$1',[boardId])).rows[0].snapshot;
  assert.equal(board.origin.ipoId,fresh.id);assert.equal(board.origin.operationsIssuanceId,issued.id);assert.equal(board.stage,'received');assert.deepEqual(board.documents,[]);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM site_workflow WHERE ipo_id=$1',[fresh.id])).rows[0].n,1);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM site_workflow WHERE ipo_id=$1',[other.id])).rows[0].n,0,'Scoped ensure does not mutate unrelated missing positions.');
  assert.deepEqual(await repo.issue(actor,input),issued);assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_board_versions WHERE site_id=$1',[boardId])).rows[0].n,1);
  const manager=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'SIMULATION Inventory owner','test-only','Admin')",[manager,manager+'@inventory.invalid']);
  const materialLinks=(await db.pool.query('SELECT * FROM inventory_material_source_links WHERE ipo_id=$1',[fresh.id])).rows;assert.equal(materialLinks.length,1);
  const inventory=await new MaterialDraftRepository(db.pool).intake(manager);assert.ok(inventory.sources.some(row=>row.sourceKind==='linked-ipo'&&row.siteId===fresh.id),'Normal handoff is immediately issuable without fabricating a Store handoff.');
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM store_boq_issuances')).rows[0].n,0);
  const continuation={boardSiteId:boardId,ipoId:fresh.id,operationsIssuanceId:issued.id};assert.deepEqual(await transaction(db.pool,c=>linkCreatedOperationsMaterialSource(c,actor,continuation)),{status:'retained',id:materialLinks[0].id});
  const stranger=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'SIMULATION other','test-only','Coordinator')",[stranger,stranger+'@handoff.invalid']);await assert.rejects(transaction(db.pool,c=>linkCreatedOperationsMaterialSource(c,stranger,continuation)),/authenticated handoff issuer/);

  assert.deepEqual((await db.pool.query("SELECT (SELECT md5(string_agg(snapshot::text,'' ORDER BY id)) FROM internal_purchase_orders) ipo,(SELECT count(*) FROM accounts_pt_entries) pt,(SELECT count(*) FROM accounts_job_closures) closures,(SELECT count(*) FROM inventory_warehouse_operational_movements) movements,(SELECT count(*) FROM stock_on_hand_entries) stock")).rows[0],protectedBefore);

  const wrongPo=await ipo(false,'WRONG-PO'),wrongIssued=await repo.issue(actor,{ipoId:wrongPo.id,notes:'SIMULATION mismatched PO',requestKey:randomUUID()});assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_material_source_links WHERE ipo_id=$1',[wrongPo.id])).rows[0].n,0);
  const wrongResult=await transaction(db.pool,c=>linkCreatedOperationsMaterialSource(c,actor,{boardSiteId:'live-ipo:'+wrongPo.id,ipoId:wrongPo.id,operationsIssuanceId:wrongIssued.id}));assert.equal(wrongResult.status,'held');if(wrongResult.status==='held')assert.match(wrongResult.reason,/po-mismatch/);
  await db.pool.query("INSERT INTO archived_sample_ipos(ipo_id,reason,source_record) VALUES($1,'SIMULATION archived eligibility', $2)",[fresh.id,{simulation:true}]);
  await assert.rejects(approvedMaterialIdentity(db.pool,fresh.id),/archived/);const archivedResult=await transaction(db.pool,c=>linkCreatedOperationsMaterialSource(c,actor,continuation));assert.equal(archivedResult.status,'held');
  assert.equal((await new MaterialDraftRepository(db.pool).intake(manager)).sources.some(row=>row.siteId===fresh.id),false);await db.pool.query('UPDATE archived_sample_ipos SET restored_at=now() WHERE ipo_id=$1',[fresh.id]);
  assert.equal((await transaction(db.pool,c=>linkCreatedOperationsMaterialSource(c,actor,continuation))).status,'retained');
  const malformed=await ipo(),malformedIssued={id:randomUUID()};
  await db.pool.query('INSERT INTO operations_boq_issuances(id,ipo_id,boq_revision_id,number,snapshot,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[malformedIssued.id,malformed.id,malformed.snapshot.boqRevisionId,'SIMULATION-BASIS-CORRUPTION',{items:[]},randomUUID(),actor]);
  await transaction(db.pool,async c=>{await new SiteWorkflowRepository(db.pool).ensure(c,malformedIssued.id);await syncCreatedOperationsHandoff(c,actor,{ipoId:malformed.id,operationsIssuanceId:malformedIssued.id});});
  const badBoard='live-ipo:'+malformed.id;const badVersion=(await db.pool.query('SELECT version FROM operations_board_versions WHERE site_id=$1',[badBoard])).rows[0].version;
  await db.pool.query('INSERT INTO inventory_material_source_links(id,board_site_id,board_version,ipo_id,boq_revision_id,board_sha256,ipo_sha256,boq_sha256,reason,request_key,request_sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$6,$6,$7,$8,$6,$9)',[randomUUID(),badBoard,badVersion,malformed.id,fresh.snapshot.boqRevisionId,'0'.repeat(64),'SIMULATION intentionally mismatched immutable basis',randomUUID(),manager]);
  const mismatch=await transaction(db.pool,c=>linkCreatedOperationsMaterialSource(c,actor,{boardSiteId:badBoard,ipoId:malformed.id,operationsIssuanceId:malformedIssued.id}));assert.equal(mismatch.status,'held');if(mismatch.status==='held')assert.match(mismatch.reason,/approved BOQ basis differs/);
  const historical=await ipo(true);await repo.issue(actor,{ipoId:historical.id,notes:'SIMULATION historical source',requestKey:randomUUID()});assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_board_sites WHERE id=$1',['live-ipo:'+historical.id])).rows[0].n,0);assert.equal((await db.pool.query('SELECT count(*)::int n FROM site_workflow WHERE ipo_id=$1',[historical.id])).rows[0].n,0);
  await db.pool.query("CREATE FUNCTION reject_simulation_handoff_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'operations.boq.issue:%' THEN RAISE EXCEPTION 'SIMULATION post-hook rollback'; END IF; RETURN NEW; END $$");
  await db.pool.query('CREATE TRIGGER reject_simulation_handoff_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_simulation_handoff_audit()');
  await assert.rejects(repo.issue(actor,{ipoId:other.id,notes:'SIMULATION rollback',requestKey:randomUUID()}),/post-hook rollback/);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_board_sites WHERE id=$1',['live-ipo:'+other.id])).rows[0].n,0);assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_boq_issuances WHERE ipo_id=$1',[other.id])).rows[0].n,0);assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_material_source_links WHERE ipo_id=$1',[other.id])).rows[0].n,0);assert.equal((await db.pool.query('SELECT count(*)::int n FROM site_workflow WHERE ipo_id=$1',[other.id])).rows[0].n,0);
  await db.pool.query('DROP TRIGGER reject_simulation_handoff_audit ON audit_log');await db.pool.query('DROP FUNCTION reject_simulation_handoff_audit()');
  await new SiteWorkflowRepository(db.pool).ensure();assert.equal((await db.pool.query('SELECT count(*)::int n FROM site_workflow WHERE ipo_id=$1',[historical.id])).rows[0].n,1,'Existing default legacy ensure remains unchanged.');
 }finally{await db.close();}
});

test('normal approved Project workflow receipt reaches the new Operations queue without changing accepted totals',async()=>{
 const db=await testDatabase();try{
  const actor=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'SIMULATION coordinator','test-only','Coordinator')",[actor,actor+'@receipt.invalid']);
  const framework=(await db.pool.query("SELECT id FROM project_framework_current WHERE customer_id=5 AND configuration_key='25-20-30:Revised'")).rows[0].id;
  const repo=new ProjectWorkflowRepository(db.pool),created=await repo.create(actor,{requestKey:randomUUID(),customerId:5,siteName:'SIMULATION approved receipt',siteCode:'REC-Q',route:'direct-framework',frameworkId:framework,notes:'Isolated transaction hook verification'});
  const basis=(await db.pool.query('SELECT data FROM project_workflow_records WHERE id=$1',[created.id])).rows[0].data.basis;
  const file=await repo.attach(actor,created.id,{kind:'PO / confirmation',filename:'SIMULATION.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4 SIMULATION').toString('base64')});const detail=await repo.detail(actor,created.id);
  const input={reference:'SIMULATION-RECEIPT',date:'2026-10-28',evidenceId:file.id,basisType:'framework',frameworkId:framework,confirmationType:'Customer PO',actual:basis.comparison,reviewed:true,notes:'Exact approved basis',saleDetails:{invoiceCompany:'PZES (PVT Ltd)',salesPerson:'SIMULATION',paymentMode:'Bank transfer'}};
  const key=randomUUID(),request={version:detail.record.version,requestKey:key,action:'receipt',input};await repo.action(actor,created.id,request);
  const issued=(await db.pool.query('SELECT * FROM project_workflow_issuances WHERE record_id=$1',[created.id])).rows[0];const ipo=(await db.pool.query('SELECT snapshot FROM internal_purchase_orders WHERE id=$1',[issued.ipo_id])).rows[0];
  assert.deepEqual(ipo.snapshot.allocation,basis.order.allocation);assert.equal((await db.pool.query('SELECT count(*)::int n FROM ipo_accounts_handoffs WHERE ipo_id=$1',[issued.ipo_id])).rows[0].n,1);
  const board=(await db.pool.query('SELECT snapshot FROM operations_board_versions WHERE site_id=$1',['live-ipo:'+issued.ipo_id])).rows[0].snapshot;assert.equal(board.origin.operationsIssuanceId,issued.operations_id);assert.equal(board.stage,'received');assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_material_source_links WHERE ipo_id=$1',[issued.ipo_id])).rows[0].n,1);
  await repo.action(actor,created.id,request);assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_board_versions WHERE site_id=$1',['live-ipo:'+issued.ipo_id])).rows[0].n,1);
  for(const table of ['accounts_pt_entries','accounts_job_closures','inventory_warehouse_operational_movements','stock_on_hand_entries'])assert.equal((await db.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);
 }finally{await db.close();}
});
