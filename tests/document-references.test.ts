import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {transaction} from '../server/db/transaction.js';
import {allocateReference,formatReference,revisedReference,documentTypes,isShortReference,isPortalReference,versionReference} from '../server/documents/references.js';
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
 const run=(type:'BOQ'|'PBQ'|'QT'|'IPO'|'SSR',id=randomUUID(),code='REFTEST')=>transaction(db.pool,c=>allocateReference(c,type,id,3,code));
 const no=(reference:string)=>Number(reference.split('-')[1]);
 // Short running numbers (Atif's standard, owner-approved): no year, customer or site in the number.
 const first=await run('QT',family);assert.match(first,/^QT-\d+$/);
 assert.equal(await run('QT',family),first,'a retry reuses the family number');
 const bof=await run('BOQ'),pbq=await run('PBQ');assert.match(bof,/^BOQ-\d+$/);assert.equal(no(pbq),no(bof)+1,'costing and customer BOQs share one BOQ series');
 await assert.rejects(transaction(db.pool,async c=>{await allocateReference(c,'IPO',randomUUID(),3,'REFTEST');throw new Error('rollback');}));
 const ipo=await run('IPO');assert.match(ipo,/^IPO-\d+$/);
 const refs=await Promise.all(Array.from({length:8},()=>run('QT')));assert.equal(new Set(refs).size,8);
 const ordinals=refs.map(no).sort((a,b)=>a-b);assert.deepEqual(ordinals,Array.from({length:8},(_,i)=>no(first)+1+i),'one running series, no gaps');
 // A typed number already in use is skipped, never given twice.
 await db.pool.query("INSERT INTO document_reference_roots(document_type,family_id,reference) VALUES('IPO',$1,$2)",[randomUUID(),'IPO-'+(no(ipo)+1)]);
 assert.equal(await run('IPO'),'IPO-'+(no(ipo)+2));
 // Other document kinds keep the long format.
 assert.match(await run('SSR'),/^CPZ-SSR-\d{2}-\d{3}-0003-/);
 assert.deepEqual((await db.pool.query('SELECT id,name,short_code,version FROM customers ORDER BY id')).rows,baseline);
 assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM boq_revisions')).rows[0].n,0);
 }finally{await db.close();}
});
test('short numbers: revisions keep the base number; the first quotation has no suffix',()=>{
 assert.equal(isShortReference('QT-5411'),true);assert.equal(isShortReference('QT-5411-R2'),true);assert.equal(isShortReference('CHP-163'),false);assert.equal(isShortReference('CPZ-QT-26-001-0003-003-R1 (BAFL-3432)'),false);
 assert.deepEqual([1,2,3].map(n=>versionReference('QT-5411',n)),['QT-5411','QT-5411-R1','QT-5411-R2']);
 assert.equal(versionReference('QT-5411-R1',3),'QT-5411-R2','works from any saved version');
 assert.equal(versionReference('CPZ-QT-26-001-0003-003 (BAFL-3432)',1),'CPZ-QT-26-001-0003-003-R1 (BAFL-3432)','older families keep their numbering');
 assert.equal(revisedReference('BOQ-1003',1),'BOQ-1003-R1');assert.equal(revisedReference('BOQ-1003-R1',2),'BOQ-1003-R2');assert.equal(revisedReference('IPO-163',1),'IPO-163-R1');
 assert.equal(isPortalReference('QT-5411'),true);assert.equal(isPortalReference('CPZ-QT-26-001-0003-003 (BAFL-3432)'),true);assert.equal(isPortalReference('CNI-1A2B3C4D-V2'),false);
});
test('the running count continues after the documents issued before the release',async()=>{
 const db=await testDatabase();try{
  for(let i=0;i<3;i++)await db.pool.query("INSERT INTO document_reference_roots(document_type,family_id,reference) VALUES('QT',$1,$2)",[randomUUID(),'CPZ-QT-26-00'+(i+1)+'-0003-001 (OLD-'+i+')']);
  const existing=(await db.pool.query("SELECT count(*)::int AS n FROM document_reference_roots WHERE document_type='QT'")).rows[0].n;
  assert.equal(await transaction(db.pool,c=>allocateReference(c,'QT',randomUUID(),3,'REFTEST')),'QT-'+(existing+1));
 }finally{await db.close();}
});
