import{test}from'node:test';
import assert from'node:assert/strict';
import{randomUUID}from'node:crypto';
import{testDatabase}from'./database.js';
import{MastersRepository}from'../server/masters/repository.js';
test('Coordinator customer edits are reasoned, version-protected, audited, and cannot change identity code/status or unrelated masters',async()=>{
 const db=await testDatabase();try{
  const actor=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Atif fixture','Coordinator','unused')",[actor,actor+'@test.invalid']);
  const repo=new MastersRepository(db.pool),before=(await db.pool.query('SELECT * FROM customers WHERE id=5')).rows[0];
  const protectedBefore=(await db.pool.query("SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) AS value FROM sites x")).rows[0].value;
  const values={...before,email:'approved-contact@ubl.example',ntn:'0801164-8'};
  await assert.rejects(repo.save(actor,'customers','5',before.version,values),/reason/);
  await assert.rejects(repo.save(actor,'customers','5',before.version,{...values,short_code:'OTHER'},'Disposable reason'),/only.*Admin/);
  await assert.rejects(repo.save(actor,'customers','5',before.version,{...values,status:'Inactive'},'Disposable reason'),/only.*Admin/);
  await repo.save(actor,'customers','5',before.version,values,'Director-confirmed contact correction');
  const after=(await db.pool.query('SELECT * FROM customers WHERE id=5')).rows[0];assert.equal(after.email,values.email);assert.equal(after.ntn,'0801164-8');assert.equal(after.version,before.version+1);assert.equal(after.short_code,before.short_code);
  const event=(await db.pool.query("SELECT action FROM audit_log WHERE user_id=$1 AND action LIKE 'master.customer.changed:%'",[actor])).rows[0];const detail=JSON.parse(event.action.slice('master.customer.changed:'.length));assert.equal(detail.before.email,before.email);assert.equal(detail.after.email,values.email);assert.equal(detail.reason,'Director-confirmed contact correction');
  await assert.rejects(repo.save(actor,'customers','5',before.version,{...values,phone:'another'},'Stale correction'),/changed/);
  assert.deepEqual((await db.pool.query("SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) AS value FROM sites x")).rows[0].value,protectedBefore);
  await assert.rejects(repo.save(actor,'rules','engineering-1',1,{value:'1',notes:''},'Not authorised'),/permission/);
  const design=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Design fixture','Design','unused')",[design,design+'@test.invalid']);
  await assert.rejects(repo.save(design,'customers','5',after.version,values,'Not authorised'),/permission/);
 }finally{await db.close();}
});
