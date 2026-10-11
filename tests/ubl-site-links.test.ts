import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {testDatabase} from './database.js';
import {migrate} from '../server/db/migrate.js';
import {UblRepository} from '../server/ubl/repository.js';

test('38 legacy UBL PO/site links preserve pricing exceptions, frozen costing and access restrictions',async()=>{
 const db=await testDatabase();try{
  const manager=randomUUID(),coordinator=randomUUID();
  for(const [id,role] of [[manager,'Management'],[coordinator,'Coordinator']])await db.pool.query('INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)',[id,`${id}@example.test`,role,'fixture-only',role]);
  const repo=new UblRepository(db.pool),rows=await repo.sites(manager);
  assert.equal(rows.length,38);assert.equal(rows.filter(r=>r.status==='Active').length,36);assert.equal(rows.filter(r=>r.po_number).length,37);
  assert.equal(new Set(rows.map(r=>r.site_id)).size,38);
  for(const r of rows){
   const site=(await db.pool.query('SELECT * FROM sites WHERE id=$1',[r.site_id])).rows[0];assert.equal(site.code,r.branch_code);
   if(r.baseline){
    const b=r.baseline;assert.equal(new Decimal(b.sellingExcludingGst).sub(b.budgetedCost).toFixed(2),new Decimal(b.markupAmount).toFixed(2));
    assert.equal(b.items.reduce((sum:Decimal,i:any)=>sum.add(i.total_ex_gst),new Decimal(0)).toString(),b.budgetedCost);
    const h=(await db.pool.query('SELECT snapshot FROM ubl_commercial_history WHERE configuration_id=$1 AND stage=$2',[r.configuration_id,r.pricing_stage])).rows[0].snapshot;
    assert.equal(b.sellingIncludingGst,h.totalIncludingGst);
   }
  }
  const byCode=(code:string)=>rows.find(r=>r.branch_code===code)!;
  for(const code of ['2261','2673'])assert.equal(byCode(code).pricing_stage,'Negotiated');
  assert.equal(byCode('2261').baseline.budgetedCost,'5434800');assert.equal(byCode('2673').baseline.budgetedCost,'3972700');
  assert.equal(byCode('1072').configuration_id,'20-20-30');assert.equal(byCode('1072').baseline.budgetedCost,'3840750');assert.match(byCode('1072').notes,/installed in error/);
  assert.equal(byCode('1683').status,'Cancelled');assert.equal(byCode('2756').baseline,null);assert.equal(byCode('2756').legacy_ipo_number,'315');
  assert.equal(byCode('0152').legacy_ipo_number,'286');assert.equal(byCode('2673').po_issued_date,'2026-05-13');
  await assert.rejects(repo.sites(coordinator),/Administrator and Management/);
  await assert.rejects(db.pool.query("UPDATE ubl_site_orders SET notes='overwrite' WHERE branch_code='1072'"),/immutable/);
  await migrate(db.pool);assert.equal((await repo.sites(manager)).length,38);
  assert.equal((await db.pool.query('SELECT count(*) AS n FROM customer_purchase_orders')).rows[0].n,'0');
 }finally{await db.close()}
});
