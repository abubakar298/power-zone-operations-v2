import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {testDatabase} from './database.js';
import {CoordinatorRepository} from '../server/coordinator/repository.js';
import {OrdersRepository} from '../server/orders/repository.js';

test('exact demo IPO archive preserves immutable source and unrelated submissions while removing department tasks and approval lists',async()=>{
  const db=await testDatabase();try{
    const actor=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'Disposable coordinator','test','Coordinator')",[actor,actor+'@example.test']);
    const ids=['f7ecce6c-32bf-4224-b4bc-9c5d7b3ea8fe','6d25165e-3626-4a1f-966b-dd4beae2d694',randomUUID()];
    for(const [i,id] of ids.entries())await db.pool.query("INSERT INTO ipo_submissions(id,input,snapshot,fingerprint,request_key,created_by) VALUES($1,'{}',$2,'unchanged',$3,$4)",[id,{quotationNumber:i<2?'Q-DEMO-S-001-R0-V2':'REAL-KEEP',siteName:i<2?'s':'Real site'},randomUUID(),actor]);
    const original=(await db.pool.query('SELECT * FROM ipo_submissions WHERE id=ANY($1::uuid[]) ORDER BY id',[ids])).rows;
    const sql=await readFile('migrations/095_archive_director_confirmed_demo_ipo_submissions.sql','utf8');await db.pool.query(sql);await db.pool.query(sql);
    assert.deepEqual((await db.pool.query('SELECT * FROM ipo_submissions WHERE id=ANY($1::uuid[]) ORDER BY id',[ids])).rows,original);
    const archive=(await db.pool.query("SELECT records FROM test_workflow_archives WHERE key='LOCAL-REVIEW-SAMPLES-DEMO-IPO-DIRECTOR-2026-10-15'")).rows;
    assert.equal(archive.length,1);assert.equal(archive[0].records.ipoSubmissions.length,2);
    const tasks=(await new CoordinatorRepository(db.pool).overview(actor,false)).tasks;
    assert.ok(ids.slice(0,2).every(id=>!tasks.some((t:any)=>t.id===id)));assert.ok(tasks.some((t:any)=>t.id===ids[2]));
    const orders=new OrdersRepository(db.pool);
    assert.deepEqual((await orders.submissions(actor)).map((s:any)=>s.id),[ids[2]]);
    await assert.rejects(orders.approve(actor,ids[0],randomUUID(),{channel:'Verbal',approver:'Test',comments:'No action',uploadIds:[]} as any),/not found/);
  }finally{await db.close();}
});
