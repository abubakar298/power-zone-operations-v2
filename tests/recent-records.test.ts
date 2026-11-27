import {test} from 'node:test';import assert from 'node:assert/strict';
import {latestActivity,recentFirst,recordedTimestamp} from '../shared/recent-records.js';import {paginateRows} from '../shared/list-pagination.js';
test('recent results use actual latest activity, ignore planned dates, and keep the full source for next pages',()=>{
 const rows=Array.from({length:23},(_,i)=>({id:String(i),created_at:`2026-10-${String(i+1).padStart(2,'0')}T10:00:00Z`,plannedDate:'2030-01-01'}));
 const original=JSON.stringify(rows),sorted=recentFirst(rows);assert.deepEqual(paginateRows(sorted,0).rows.map(r=>r.id),['22','21','20','19','18','17','16','15','14','13']);assert.equal(paginateRows(sorted,1).rows[0].id,'12');assert.equal(paginateRows(sorted,2).rows.length,3);assert.equal(JSON.stringify(rows),original);
 assert.equal(recordedTimestamp({plannedDate:'2030-01-01',expectedDelivery:'2031-01-01'}),0);
 assert.deepEqual(recentFirst([{id:'a',createdAt:'2026-10-01',updatedAt:'2026-11-01'},{id:'b',createdAt:'2026-10-31',plannedDate:'2030-01-01'}]).map(r=>r.id),['a','b']);
});
test('undated registrations use numeric creation IDs; unknown dates and equal timestamps stay stable',()=>{
 assert.deepEqual(recentFirst([{id:2},{id:19},{id:4}]).map(r=>r.id),[19,4,2]);
 const rows=[{id:'legacy-b',updatedAt:'not recorded'},{id:'legacy-a',updatedAt:'not recorded'}];assert.deepEqual(recentFirst(rows),rows);
 const tied=[{id:1,createdAt:'2026-10-01'},{id:99,createdAt:'2026-10-01'}];assert.deepEqual(recentFirst(tied),tied);
 assert.equal(recordedTimestamp({updatedAt:new Date('invalid')}),0);
});
test('one newest-first rule: latest of updated, uploaded, received or last activity, falling back to created time',()=>{
 const rows=[
  {id:'created-only',created_at:'2026-11-20T09:00:00Z'},
  {id:'uploaded',created_at:'2026-10-01T09:00:00Z',uploadedAt:'2026-11-24T09:00:00Z'},
  {id:'last-activity',createdAt:'2026-09-01T09:00:00Z',lastActivityAt:'2026-11-25T09:00:00Z'},
  {id:'cancelled',created_at:'2026-08-01T09:00:00Z',cancelledAt:'2026-11-22T09:00:00Z'},
  {id:'planned-only',dispatchDate:'2026-12-30',installationDate:'2027-01-05'},
 ];
 assert.deepEqual(recentFirst(rows).map(r=>r.id),['last-activity','uploaded','cancelled','created-only','planned-only']);
 assert.equal(latestActivity('2026-11-01T00:00:00Z',new Date('2026-11-03T00:00:00Z'),null,undefined,'not a date'),'2026-11-03T00:00:00.000Z');
 assert.equal(latestActivity(null,undefined,'Not recorded'),null);
});
test('serial numbers follow the final newest-first order continuously across pages',()=>{
 const rows=Array.from({length:12},(_,i)=>({id:`r${i}`,updated_at:`2026-11-${String(i+1).padStart(2,'0')}T08:00:00Z`}));
 const numbered=recentFirst(rows).map((row,index)=>({...row,sr:index+1}));
 assert.deepEqual(paginateRows(numbered,1).rows.map(r=>[r.sr,r.id]),[[11,'r1'],[12,'r0']]);
});
