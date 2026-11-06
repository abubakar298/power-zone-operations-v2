import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {InventoryReviewRepository} from '../server/inventory/review-register.js';
import {WarehouseSourceRepository} from '../server/inventory/warehouse-register.js';
import {WarehouseAuthorityRepository,warehousePosition} from '../server/inventory/warehouse-ledger.js';
import {prepareInventoryReview} from '../server/inventory/review-source.js';

async function fixture(pool:any){
 const owner=randomUUID(),reviewer=randomUUID();for(const [id,role] of [[owner,'Admin'],[reviewer,'Inventory']])await pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@ledger.example.test',role,role,'isolated']);
 const catalogue={rows:[{itemId:'FINAL'}]},source={groups:[{id:'batch',title:'Batch',warehouse:'Lahore',rows:[{id:'cable',item:'Cable',itemId:'FINAL',unit:'m',origin:'warehouse_stock',status:'Review needed',dispatch:10,used:7,countedReturn:3,credited:1}]}]};
 const review=new InventoryReviewRepository(pool),warehouse=new WarehouseSourceRepository(pool),sha='a'.repeat(64),catalogueSha='b'.repeat(64),stockSha='c'.repeat(64);
 await review.importSource(owner,{sourceSha256:sha,catalogueSha256:catalogueSha,source,catalogue});
 await warehouse.importSource(owner,{sourceSha256:stockSha,catalogueSha256:catalogueSha,reviewSourceSha256:sha,finalItemIds:['FINAL'],source:{meta:{canonicalIds:1},balances:[{itemId:'FINAL',warehouse:'Lahore warehouse',unit:'m',description:'Cable',opening:10,in:5,out:8,closing:7,openingStatus:'Reviewed source',review:''}],events:[{eventId:'old-in',itemId:'FINAL',warehouse:'Lahore warehouse',unit:'m',description:'Cable',in:5,out:0},{eventId:'old-out',itemId:'FINAL',warehouse:'Lahore warehouse',unit:'m',description:'Cable',in:0,out:8}]}});
 const row=prepareInventoryReview(source,catalogue).cases[0],closing=await warehouse.caseClosing(row.id,row);if(!closing.available)throw Error('Expected fixture balance.');
 return {owner,reviewer,review,warehouse,row,stockSha,key:closing.ledgerKey};
}
test('warehouse baseline authority requires explicit Management decision and never rebases or posts historical stock',async()=>{
 const db=await testDatabase();try{
  const f=await fixture(db.pool),repo=new WarehouseAuthorityRepository(db.pool),input={warehouse:'Lahore warehouse',version:0,sourceSha256:f.stockSha,state:'active' as const,reason:'Verified isolated source for operational rehearsal.',requestKey:randomUUID()};
  await assert.rejects(repo.command(f.reviewer,input),/Management/);
  const saved=await repo.command(f.owner,input);assert.equal(saved.version,1);assert.deepEqual(await repo.command(f.owner,input),saved);
  await assert.rejects(repo.command(f.owner,{...input,reason:'Different reason'}),/another baseline decision/);
  await assert.rejects(repo.command(f.owner,{...input,requestKey:randomUUID()}),/decision changed/);
  await assert.rejects(repo.command(f.owner,{...input,version:1,sourceSha256:'d'.repeat(64),requestKey:randomUUID()}),/cannot be replaced/);
  const suspended=await repo.command(f.owner,{...input,version:1,state:'suspended',requestKey:randomUUID()});assert.equal(suspended.version,2);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_warehouse_operational_movements')).rows[0].n,0);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM stock_on_hand_entries')).rows[0].n,0);
  assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))?.currentClosing,'7');
  await assert.rejects(db.pool.query('DELETE FROM inventory_warehouse_authority_versions'));
 }finally{await db.close();}
});
test('operational OUT and verified IN share closing revisions with historical correction approvals without replaying source events',async()=>{
 const db=await testDatabase();try{
  const f=await fixture(db.pool);
  await db.pool.query('INSERT INTO inventory_review_access(user_id,capability,granted_by,reason) VALUES($1,$2,$3,$4),($3,$5,$3,$4)',[f.reviewer,'reviewer',f.owner,'Isolated ledger test','approver']);
  const proposal={treatment:'verify-return' as const,explanation:'Missing verified historical credit.',evidence:[{reference:'Fictional signed IGP',description:'3m counted, 1m credited'}],returnCorrection:{sourceSha256:f.stockSha,ledgerKey:f.key,ledgerRevision:0,inDelta:'2'}};
  await f.review.command(f.reviewer,f.row.id,{version:1,requestKey:randomUUID(),action:'propose',reason:'Receipt checked.',proposal});
  // Explicit fictional low-level fixture: normalized documents and movements
  // test database constraints/projection, not a public stock-posting endpoint.
  const draft=randomUUID(),dispatch=randomUUID(),line=randomUUID(),movement=randomUUID(),receipt=randomUUID(),evidence=randomUUID();
  await db.pool.query('INSERT INTO inventory_material_drafts(id,created_by) VALUES($1,$2)',[draft,f.owner]);
  await db.pool.query('INSERT INTO inventory_material_draft_versions(draft_id,version,snapshot,request_key,request_fingerprint,created_by) VALUES($1,1,$2,$3,$4,$5)',[draft,{},randomUUID(),'0'.repeat(64),f.owner]);
  await db.pool.query('INSERT INTO inventory_material_dispatches(id,number,draft_id,draft_version,source_sha256,warehouse,snapshot,request_key,request_fingerprint,created_by) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9)',[dispatch,'SAMPLE-DO-1',draft,f.stockSha,'Lahore warehouse',{},randomUUID(),'1'.repeat(64),f.owner]);
  await db.pool.query('INSERT INTO inventory_material_dispatch_lines(dispatch_id,line_key,source_sha256,ledger_key,item_id,unit,description,quantity) VALUES($1,$2,$3,$4,$5,$6,$7,2)',[dispatch,line,f.stockSha,f.key,'FINAL','m','Cable']);
  await db.pool.query("INSERT INTO inventory_warehouse_operational_movements(id,source_sha256,ledger_key,ledger_revision,kind,draft_id,dispatch_id,line_key,in_delta,out_delta,closing_before,closing_after,created_by) VALUES($1,$2,$3,1,'dispatch-out',$7,$4,$5,0,2,7,5,$6)",[movement,f.stockSha,f.key,dispatch,line,f.owner,draft]);
  let position=await warehousePosition(db.pool,f.stockSha,f.key);assert.equal(position?.currentClosing,'5');assert.equal(position?.ledgerRevision,1);assert.equal(position?.totalOut,'10');
  await assert.rejects(f.review.command(f.owner,f.row.id,{version:2,requestKey:randomUUID(),action:'approve',reason:'Old proposal must be refreshed.'}),/closing balance changed/);
  await f.review.command(f.owner,f.row.id,{version:2,requestKey:randomUUID(),action:'return-for-clarification',reason:'Physical dispatch changed this balance.'});
  await f.review.command(f.reviewer,f.row.id,{version:3,requestKey:randomUUID(),action:'propose',reason:'Same historical credit, refreshed ledger.',proposal:{...proposal,returnCorrection:{...proposal.returnCorrection,ledgerRevision:1}}});
  await f.review.command(f.owner,f.row.id,{version:4,requestKey:randomUUID(),action:'approve',reason:'Verified historical return remains due.'});
  position=await warehousePosition(db.pool,f.stockSha,f.key);assert.equal(position?.currentClosing,'7');assert.equal(position?.ledgerRevision,2);
  await db.pool.query('INSERT INTO inventory_material_evidence(id,warehouse,original_name,media_type,content,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[evidence,'Lahore warehouse','SAMPLE.pdf','application/pdf',Buffer.from('%PDF-FAKE-TEST-ONLY'),'2'.repeat(64),f.owner]);
  await db.pool.query('INSERT INTO inventory_material_receipts(id,number,draft_id,evidence_id,reason,snapshot,request_key,request_fingerprint,verified_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[receipt,'SAMPLE-IGP-1',draft,evidence,'Fictional counted return.',{},randomUUID(),'3'.repeat(64),f.owner]);
  await db.pool.query('INSERT INTO inventory_material_receipt_lines(receipt_id,draft_id,dispatch_id,line_key,quantity) VALUES($1,$4,$2,$3,1)',[receipt,dispatch,line,draft]);
  await db.pool.query("INSERT INTO inventory_warehouse_operational_movements(id,source_sha256,ledger_key,ledger_revision,kind,draft_id,dispatch_id,receipt_id,line_key,in_delta,out_delta,closing_before,closing_after,created_by) VALUES($1,$2,$3,3,'return-in',$8,$4,$5,$6,1,0,7,8,$7)",[randomUUID(),f.stockSha,f.key,dispatch,receipt,line,f.owner,draft]);
  position=await warehousePosition(db.pool,f.stockSha,f.key);assert.equal(position?.currentClosing,'8');assert.equal(position?.ledgerRevision,3);assert.equal(position?.totalIn,'8');assert.equal(position?.operationalIn,'1');assert.equal(position?.historicalReturnCorrections,'2');
  const shared=await f.warehouse.caseClosing(f.row.id,f.row);assert.equal(shared.available&&shared.currentClosing,'8');assert.equal(shared.available&&shared.ledgerRevision,3);assert.equal(shared.available&&shared.totalIn,'8');assert.equal(shared.available&&shared.totalOut,'10');if(shared.available)assert.equal(new (await import('decimal.js')).Decimal(shared.balance.opening!).plus(shared.totalIn).minus(shared.totalOut).toString(),shared.currentClosing,'Displayed opening + total IN - total OUT equals the current closing after return corrections and physical movements');
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_warehouse_source_events')).rows[0].n,2);assert.equal((await db.pool.query('SELECT count(*)::int n FROM stock_on_hand_entries')).rows[0].n,0);
  await assert.rejects(db.pool.query('UPDATE inventory_warehouse_operational_movements SET in_delta=5 WHERE id=$1',[movement]));
  await assert.rejects(db.pool.query('DELETE FROM inventory_material_dispatch_lines'));
 }finally{await db.close();}
});

test('warehouse activation and legacy global counts cannot race into two stock authorities',async()=>{
 const db=await testDatabase();try{
  const f=await fixture(db.pool),{ProcurementRepository}=await import('../server/procurement/repository.js');
  await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[f.reviewer,f.owner]);
  const item=(await db.pool.query('SELECT key,unit FROM item_master ORDER BY key LIMIT 1')).rows[0];
  const result=await Promise.allSettled([
   new WarehouseAuthorityRepository(db.pool).command(f.owner,{warehouse:'Lahore warehouse',version:0,sourceSha256:f.stockSha,state:'active',reason:'Fictional race verification.',requestKey:randomUUID()}),
   new ProcurementRepository(db.pool).setCount(f.reviewer,{itemKey:item.key,quantity:'1',unit:item.unit,note:'Fictional concurrent legacy count.'}),
  ]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1,'Either the new baseline activates or the old count posts; both must never succeed.');
  const authorities=(await db.pool.query('SELECT count(*)::int n FROM inventory_warehouse_authority_versions')).rows[0].n,counts=(await db.pool.query('SELECT count(*)::int n FROM stock_on_hand_entries')).rows[0].n;
  assert.equal(authorities+counts,1);assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_warehouse_operational_movements')).rows[0].n,0);
 }finally{await db.close();}
});

test('ambiguous historical credit cannot post on approval; verified overcredit retains signed IN reversal',async()=>{
 const db=await testDatabase();try{
  const f=await fixture(db.pool),catalogue={rows:[{itemId:'FINAL'}]},base={item:'Cable',itemId:'FINAL',unit:'m',origin:'warehouse_stock',status:'Needs review',dispatch:10,used:7,countedReturn:3};
  const source={groups:[{id:'credit-holds',title:'Credit attribution',warehouse:'Lahore',rows:[{...base,id:'ambiguous',credited:1,creditAmbiguous:true},{...base,id:'overcredit',credited:5}]}]},sha='d'.repeat(64);
  await f.review.importSource(f.owner,{sourceSha256:sha,catalogueSha256:'b'.repeat(64),source,catalogue});
  await db.pool.query('INSERT INTO inventory_review_warehouse_sources(review_source_sha256,warehouse_source_sha256,created_by) VALUES($1,$2,$3)',[sha,f.stockSha,f.owner]);
  await db.pool.query("INSERT INTO inventory_review_access(user_id,capability,granted_by,reason) VALUES($1,'reviewer',$2,'Fixture'),($2,'approver',$2,'Fixture')",[f.reviewer,f.owner]);
  const [ambiguous,overcredit]=prepareInventoryReview(source,catalogue).cases;
  const correction={sourceSha256:f.stockSha,ledgerKey:f.key,ledgerRevision:0,inDelta:'2'},proposal={treatment:'verify-return' as const,explanation:'Receipt evidence',evidence:[{reference:'Fictional receipt',description:'Original receipt quantity retained'}],returnCorrection:correction};
  const detail=await f.review.detail(f.owner,ambiguous.id);assert.ok(detail.closing.available&&detail.closing.holds.some((h:string)=>/credit attribution/.test(h)));assert.equal(detail.closing.available&&detail.closing.suggestedReturnCorrection,null);
  await assert.rejects(f.review.command(f.reviewer,ambiguous.id,{version:1,requestKey:randomUUID(),action:'propose',reason:'Attempt cannot bypass credit attribution',proposal}),/Complete the item/);
  // An older prepared proposal must be rechecked at approval, rather than trusted.
  await db.pool.query("INSERT INTO inventory_review_versions(case_id,version,state,proposal,reason,request_key,request_fingerprint,created_by) VALUES($1,2,'proposed',$2,'Older prepared proposal',$3,$4,$5)",[ambiguous.id,proposal,randomUUID(),'f'.repeat(64),f.reviewer]);
  await assert.rejects(f.review.command(f.owner,ambiguous.id,{version:2,requestKey:randomUUID(),action:'approve',reason:'Ambiguous credit stays held'}),/Complete the item/);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_warehouse_return_corrections')).rows[0].n,0);
  await f.review.command(f.reviewer,overcredit.id,{version:1,requestKey:randomUUID(),action:'propose',reason:'Reverse verified excess historical credit',proposal:{...proposal,returnCorrection:{...correction,inDelta:'-2'}}});
  await f.review.command(f.owner,overcredit.id,{version:2,requestKey:randomUUID(),action:'approve',reason:'Verified excess credit reversal'});
  assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))?.currentClosing,'5');assert.equal((await db.pool.query('SELECT in_delta::text FROM inventory_warehouse_return_corrections')).rows[0].in_delta,'-2.000000');
 }finally{await db.close();}
});
