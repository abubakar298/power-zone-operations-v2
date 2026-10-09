import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {transaction} from '../server/db/transaction.js';
import {allocateReference,formatReference,revisedReference,documentTypes} from '../server/documents/references.js';
test('approved reference format, all families, revision placement and overflow',()=>{
 for(const type of documentTypes)assert.equal(formatReference(type,2026,1,3,3,'BAFL','3432'),`CPZ-${type}-26-001-0003-003 (BAFL-3432)`);
 assert.equal(revisedReference(formatReference('QT',2026,1,3,3,'BAFL','3432'),1),'CPZ-QT-26-001-0003-003-R1 (BAFL-3432)');
 assert.equal(revisedReference('CPZ-QT-26-001-0003-003-R1 (BAFL-3432)',2),'CPZ-QT-26-001-0003-003-R2 (BAFL-3432)');
 assert.match(formatReference('IPO',2027,1000,12345,1001,'BAFL','3432'),/^CPZ-IPO-27-1000-12345-1001/);
});
test('transactional registry: independent counters, replay, rollback, concurrent saves and protected masters',async()=>{
 const db=await testDatabase();try {
 const baseline=(await db.pool.query('SELECT id,name,short_code,version FROM customers ORDER BY id')).rows;
 const family=randomUUID();
 const run=(type:'BOQ'|'QT'|'IPO',id=randomUUID(),code='REFTEST')=>transaction(db.pool,c=>allocateReference(c,type,id,3,code));
 const first=await run('QT',family);assert.match(first,/^CPZ-QT-\d{2}-001-0003-\d{3} \(/);
 assert.equal(await run('QT',family),first);
 const bof=await run('BOQ');assert.match(bof,/^CPZ-BOQ-\d{2}-001-/);
 await assert.rejects(transaction(db.pool,async c=>{await allocateReference(c,'IPO',randomUUID(),3,'REFTEST');throw new Error('rollback');}));
 assert.match(await run('IPO'),/^CPZ-IPO-\d{2}-001-/);
 const refs=await Promise.all(Array.from({length:8},()=>run('QT')));assert.equal(new Set(refs).size,8);
 const ordinals=refs.map(s=>Number(s.split('-')[3])).sort((a,b)=>a-b);assert.deepEqual(ordinals,[2,3,4,5,6,7,8,9]);
 assert.deepEqual((await db.pool.query('SELECT id,name,short_code,version FROM customers ORDER BY id')).rows,baseline);
 assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM boq_revisions')).rows[0].n,0);
 }finally{await db.close();}
});
