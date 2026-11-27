import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {historicalIssueReviews,historicalQcIssues} from '../server/inventory/historical-qc-issues.js';
import {HistoricalReviewConfirmations,confirmedHistoricalReviews,historicalReviewHash,reviewStillOpen} from '../server/inventory/historical-review-confirmations.js';
import {testDatabase} from './database.js';

test('every listed old DO note is the one QC is held by',()=>{
 const holds=historicalIssueReviews();
 assert.ok(holds.length>0);
 assert.equal(new Set(holds.map(h=>h.boardId)).size,holds.length,'one note per site');
 for(const h of holds)assert.equal(historicalQcIssues(h.boardId,h.ipo)?.review,h.review,h.boardId);
});

test('the Inventory head confirms an old DO note once, with a reason, and the hold lifts',async()=>{
 const {pool,close}=await testDatabase();
 try{
  const user=async(role:string,name:string)=>{const id=randomUUID();await pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',name,role,'isolated']);return id;};
  const admin=await user('Admin','Admin'),head=await user('Inventory','Inventory head'),dispatcher=await user('Inventory','Dispatcher');
  await pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$3),($1,'Lahore warehouse','head',$3),($2,'Lahore warehouse','dispatcher',$3)",[head,dispatcher,admin]);
  const repo=new HistoricalReviewConfirmations(pool);
  const [hold]=historicalIssueReviews(),reviewHash=historicalReviewHash(hold.review);
  const input={requestKey:randomUUID(),reviewHash,reason:'Duct and pipe were bought locally by the site team.'};

  assert.deepEqual(await repo.list(dispatcher),{canConfirm:false,reviews:[]});
  assert.equal((await repo.list(head)).canConfirm,true);
  await assert.rejects(repo.confirm(dispatcher,hold.boardId,input),/Only the Inventory head/);
  await assert.rejects(repo.confirm(head,hold.boardId,{...input,reviewHash:'0'.repeat(64)}),/note changed/);
  assert.equal(reviewStillOpen(await confirmedHistoricalReviews(pool),hold.boardId,hold.review),hold.review,'held before confirmation');

  assert.deepEqual(await repo.confirm(head,hold.boardId,input),{confirmed:true});
  assert.deepEqual(await repo.confirm(head,hold.boardId,input),{confirmed:true},'a retry returns the same result');
  await assert.rejects(repo.confirm(head,hold.boardId,{...input,requestKey:randomUUID()}),/already confirmed/);
  assert.equal(reviewStillOpen(await confirmedHistoricalReviews(pool,[hold.boardId]),hold.boardId,hold.review),undefined,'the hold lifts');
  assert.equal(reviewStillOpen(await confirmedHistoricalReviews(pool),hold.boardId,hold.review+' Changed.'),hold.review+' Changed.','a changed note needs a new confirmation');

  const saved=(await pool.query('SELECT reason,confirmed_by FROM inventory_historical_review_confirmations WHERE site_id=$1',[hold.boardId])).rows;
  assert.deepEqual(saved,[{reason:input.reason,confirmed_by:head}]);
  await assert.rejects(pool.query('DELETE FROM inventory_historical_review_confirmations'),'confirmations are append-only');
 }finally{await close();}
});
