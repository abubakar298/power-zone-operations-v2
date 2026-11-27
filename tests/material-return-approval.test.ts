import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {MaterialStockRepository} from '../server/inventory/material-stock.js';
import {WarehouseAuthorityRepository,warehousePosition} from '../server/inventory/warehouse-ledger.js';
import {testDatabase} from './database.js';
import {materialStockFixture} from './material-stock-fixture.js';

test('a counted return waits for the Inventory head, who approves it into stock or rejects it',async()=>{
 const {pool,close}=await testDatabase();
 try{
  const itemId='CH-CBL-AC-16MM/4C-PK',warehouse='Lahore warehouse',checksum='a'.repeat(64);
  const {owner,stockSha,key}=await materialStockFixture(pool,itemId);
  await new WarehouseAuthorityRepository(pool).command(owner,{warehouse,version:0,sourceSha256:stockSha,state:'active',reason:'Fixture baseline',requestKey:randomUUID()});
  const counter=randomUUID();
  await pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[counter,counter+'@example.test','Dispatcher','Inventory','isolated']);
  await pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[counter,owner]);
  // One site DO of 2 m, posted at the gate: closing 7 -> 5.
  const customer=(await pool.query('SELECT id FROM customers ORDER BY id LIMIT 1')).rows[0].id,siteId=randomUUID(),po=randomUUID();
  await pool.query('INSERT INTO customer_purchase_orders(id,customer_id,po_number,input,created_by) VALUES($1,$2,$3,$4,$5)',[po,customer,'RETURN-SITE',{},owner]);
  await pool.query('INSERT INTO internal_purchase_orders(id,customer_po_id,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[siteId,po,'RETURN-SITE',{},checksum,randomUUID(),owner]);
  const draftId=randomUUID(),lineKey=randomUUID(),dispatchId=randomUUID();
  const snapshot={parent:false,kind:'variable',warehouse,sites:[{siteId,registeredSiteId:'RETURN-SITE',basisId:randomUUID(),basisVersion:1,siteName:'Return site',ipo:'RETURN-SITE',customer:'Fixture',installation:true}],lines:[{key:lineKey,itemId,description:'AC cable',unit:'m',out:'2',sites:[siteId]}]};
  await pool.query('INSERT INTO inventory_material_drafts(id,created_by) VALUES($1,$2)',[draftId,owner]);
  await pool.query('INSERT INTO inventory_material_draft_versions(draft_id,version,snapshot,request_key,request_fingerprint,created_by) VALUES($1,1,$2,$3,$4,$5)',[draftId,snapshot,randomUUID(),checksum,owner]);
  await pool.query('INSERT INTO inventory_material_dispatches(id,number,draft_id,draft_version,source_sha256,warehouse,snapshot,request_key,request_fingerprint,created_by) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9)',[dispatchId,'TEST-DO-RETURN',draftId,stockSha,warehouse,snapshot,randomUUID(),checksum,owner]);
  await pool.query("INSERT INTO inventory_material_dispatch_lines(dispatch_id,line_key,source_sha256,ledger_key,item_id,unit,description,quantity) VALUES($1,$2,$3,$4,$5,'m','AC cable',2)",[dispatchId,lineKey,stockSha,key,itemId]);
  await pool.query("INSERT INTO inventory_warehouse_operational_movements(id,source_sha256,ledger_key,ledger_revision,kind,draft_id,dispatch_id,line_key,in_delta,out_delta,closing_before,closing_after,created_by) VALUES($1,$2,$3,1,'dispatch-out',$4,$5,$6,0,2,7,5,$7)",[randomUUID(),stockSha,key,draftId,dispatchId,lineKey,owner]);
  const stock=new MaterialStockRepository(pool);
  const head=randomUUID();
  await pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[head,head+'@example.test','Inventory head','Inventory','isolated']);
  await pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2),($1,'Lahore warehouse','head',$2)",[head,owner]);
  const evidence=await stock.uploadEvidence(counter,{warehouse:warehouse,filename:'signed-return-igp.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7 FICTIONAL SIGNED RETURN IGP').toString('base64')});
  const counted={draftId:draftId,requestKey:randomUUID(),sourceSha256:stockSha,authorityVersion:1,evidenceId:evidence.id,reason:'Site cancelled on arrival; counted back at the gate.',lines:[{lineKey,quantity:'1',ledgerRevision:1}]};
  const closing=async()=>(await warehousePosition(pool,stockSha,key))?.currentClosing;
  await assert.rejects(stock.submitReturn(counter,{...counted,requestKey:randomUUID(),lines:[{...counted.lines[0],quantity:'5'}]}),/exceeds material actually dispatched/,'a submission is checked like a credit');
  const submitted=await stock.submitReturn(counter,counted);
  assert.equal(submitted.stockPosted,false);assert.deepEqual(await stock.submitReturn(counter,counted),submitted,'retry returns the same submission');
  assert.equal(await closing(),'5','submitting a signed Return IGP moves no stock');
  assert.equal((await pool.query('SELECT count(*)::int n FROM inventory_material_receipts')).rows[0].n,0);
  await assert.rejects(stock.submitReturn(counter,{...counted,requestKey:randomUUID()}),/already waiting for the Inventory head/);
  const waiting=(await pool.query("SELECT owner_id,reference,actionable FROM notification_events WHERE kind='Return IGP awaiting approval'")).rows;
  assert.deepEqual(waiting.map(r=>r.owner_id),[head],'only the Inventory head is asked');assert.match(waiting[0].reference,/Site cancelled on arrival/);assert.equal(waiting[0].actionable,true);
  const decision={submissionId:submitted.id,requestKey:randomUUID(),decision:'reject' as const,reason:'Count does not match the IGP; recount.'};
  await assert.rejects(stock.decideReturn(counter,decision),/Only the Inventory head/,'a dispatcher without the head grant cannot decide');
  const rejected=await stock.decideReturn(head,decision);assert.equal(rejected.decision,'rejected');assert.equal(rejected.stockPosted,false);
  assert.equal(await closing(),'5');
  assert.equal((await pool.query("SELECT count(*)::int n FROM notification_events WHERE kind='Return IGP awaiting approval'")).rows[0].n,0,'a decided return leaves the head’s list');
  assert.deepEqual((await pool.query("SELECT owner_id FROM notification_events WHERE kind='Return IGP rejected'")).rows.map(r=>r.owner_id),[counter],'the person who counted hears back');
  await assert.rejects(stock.decideReturn(head,{...decision,requestKey:randomUUID(),decision:'approve'}),/already rejected/);
  const again=await stock.submitReturn(counter,{...counted,requestKey:randomUUID(),reason:'Recounted: one metre returned.'});
  const approve={submissionId:again.id,requestKey:randomUUID(),decision:'approve' as const,reason:'Checked against the signed IGP.'};
  const approved=await stock.decideReturn(head,approve);
  assert.equal(approved.stockPosted,true);assert.match(approved.number!,/^CPZ-IGP-/);assert.deepEqual(await stock.decideReturn(head,approve),approved,'retry is idempotent');
  assert.equal(await closing(),'6','approval credits the counted return');
  const receipt=(await pool.query('SELECT verified_by,snapshot FROM inventory_material_receipts WHERE id=$1',[approved.receiptId])).rows[0];
  assert.equal(receipt.verified_by,head);assert.equal(receipt.snapshot.approval.submittedBy,counter);
  const listed=await stock.returnApprovals(head,draftId);assert.equal(listed.canApprove,true);
  assert.deepEqual(listed.submissions.map(s=>[s.status,s.receiptNumber]),[['approved',approved.number],['rejected',null]]);
  assert.equal((await stock.returnApprovals(counter,draftId)).canApprove,false);
  await assert.rejects(pool.query("UPDATE inventory_material_return_decisions SET reason='changed'"),/immutable|not allowed|cannot/i,'decisions are append-only');
 }finally{await close();}
});

test('Inventory is told when Operations records that delivered material came back',async()=>{
 const [{OperationsBoardRepository},{NotificationsRepository},{activateWorkflowHandoffs},{readWorkflowSite}]=await Promise.all([
  import('../server/operations-board/repository.js'),import('../server/notifications/repository.js'),import('../server/notifications/handoff-activation.js'),import('./operations-snapshot.js')]);
 const {pool,close}=await testDatabase();
 try{
  const owner=randomUUID(),lead=randomUUID(),qc=randomUUID(),inventory=randomUUID(),accounts=randomUUID();
  for(const [id,role] of [[owner,'Admin'],[lead,'Operations'],[qc,'Operations'],[inventory,'Inventory'],[accounts,'Accounts']])await pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role,role,'isolated']);
  for(const [id,kind] of [[lead,'lead'],[qc,'qc']])await pool.query("INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,$2,'central',$3)",[id,kind,owner]);
  await pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[inventory,owner]);
  const repo=new OperationsBoardRepository(pool);
  await repo.importSource(owner,{sourceSha256:'f'.repeat(64),rows:[{id:'came-back',ipo:'IPO-BACK',name:'Cancelled at arrival',stage:'delivered',projectType:'ups',installation:true,completed:false,operationsTeam:'central',deliveryDate:'2026-11-25'}]});
  await activateWorkflowHandoffs(pool,owner,{version:0,requestKey:randomUUID(),recipients:{inventory:[inventory],accounts:[accounts],qc:[qc],leads:[lead],management:[owner]},reason:'Return notices'});
  await pool.query("UPDATE notification_settings SET email_enabled=true,activated_at=now()-interval '1 day'");
  const site=await readWorkflowSite(repo,owner,'came-back');
  await repo.command(lead,'came-back',{action:'delivery-return',scope:'full',date:'2026-11-26',dateUnknown:false,warehouse:'Lahore warehouse',reference:'Trip 4',reason:'Customer cancelled on arrival',version:site.version,requestKey:randomUUID(),edit:false} as any);
  const notices=new NotificationsRepository(pool);await notices.sync();
  const inbox=(await notices.list({id:inventory,role:'Inventory'} as any)).filter(n=>n.kind==='Material returned by Operations');
  assert.equal(inbox.length,1);assert.match(inbox[0].reference,/IPO-BACK \| Cancelled at arrival \| .*Customer cancelled on arrival/);
 }finally{await close();}
});
