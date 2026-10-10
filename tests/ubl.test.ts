import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {testDatabase} from './database.js';
import {UblRepository} from '../server/ubl/repository.js';
import {allocateRemaining,panelActual,ublBudget,type UblConfiguration} from '../server/ubl/engine.js';
import {MastersRepository} from '../server/masters/repository.js';
import {CommercialRepository} from '../server/commercial/repository.js';

test('UBL originals, amendments, July prices and twelve negotiation stages are immutable and scoped',async()=>{
 const db=await testDatabase();try{
  const manager=randomUUID(),coordinator=randomUUID(),accounts=randomUUID();
  for(const [id,role] of [[manager,'Management'],[coordinator,'Coordinator'],[accounts,'Accounts']])await db.pool.query('INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)',[id,`${id}@example.test`,role,'fixture-only',role]);
  const repo=new UblRepository(db.pool),masters=await new MastersRepository(db.pool).list(),policy=await new CommercialRepository(db.pool).standardPolicy(manager);
  const expected=[['20-20-30','5279116','900240','90024','818400'],['25-20-30','5756753','1118400','111840','1016727.2727272727272727272727272727272727272727273'],['30-30-40','7200000','1336720','133672','1215200'],['35-30-40','7800000','1554960','155496','1413600']];
  assert.equal((await repo.list(manager)).length,4);
  const totals:Record<string,string[]>={'20-20-30':['5123087','4919116','5279116'],'25-20-30':['5536571','5247753','5756753'],'30-30-40':['7225442','6830000','7200000'],'35-30-40':['7609940','7185000','7800000']};
  for(const [id,total,panel,tax,reference] of expected){
   const d=await repo.detail(manager,id);assert.equal(d.history.length,3);
   assert.deepEqual(d.history.map(h=>h.snapshot.totalIncludingGst),totals[id]);
   assert.equal(d.history.at(-1)!.snapshot.totalIncludingGst,total);
   const original=d.technical[0],current=d.technical[1];assert.equal(current.effective_date,null);
   assert.equal(original.snapshot.rows.find((r:any)=>r.id==='E18').proposalSellingRate,'5980');
   assert.match(current.snapshot.rows.find((r:any)=>r.id==='E18').specification,/100A rotary/);
   assert.equal(current.snapshot.rows.find((r:any)=>r.id==='E19').quantity,'10');
   assert.equal(current.snapshot.rows.find((r:any)=>r.id==='E20').quantity,'20');
   if(id.startsWith('30-')||id.startsWith('35-')){
    assert.match(original.snapshot.rows.find((r:any)=>r.id==='E19').specification,/25 mm/);
    assert.match(current.snapshot.rows.find((r:any)=>r.id==='E19').specification,/16 mm/);
    assert.match(current.snapshot.rows.find((r:any)=>r.id==='E20').specification,/25 mm/);
    assert.equal(current.snapshot.rows.find((r:any)=>r.id==='E15').quantity,'3');
   }
   const snapshot=ublBudget(current.snapshot as UblConfiguration,masters,policy);
   assert.equal(snapshot.panel.sellingExcludingGst,panel);assert.equal(snapshot.panel.gst,`${tax}.00`);
   assert.equal(new Decimal(snapshot.panel.referenceBudget).toFixed(2),new Decimal(reference).toFixed(2));
   assert.equal(snapshot.panel.budgetedMarkup,'10');assert.equal(snapshot.panel.actual.profit,null);
   const cheaper={...masters,rates:masters.rates.map(r=>r.key==='Solar PV Modules'?{...r,rate:'20'}:r)};
   const newEstimate=ublBudget(current.snapshot,cheaper,policy);
   assert.equal(newEstimate.panel.referenceBudget,snapshot.panel.referenceBudget);
   assert.equal(newEstimate.fixedAgreedTotal,total);
   assert.ok(new Decimal(newEstimate.panel.currentPurchaseEstimate!).lt(snapshot.panel.currentPurchaseEstimate!));
   assert.ok(snapshot.issues.some(i=>i.id==='H29'));assert.equal(snapshot.combinedTemplateBudget,null);
   const source=await repo.source(manager,id);assert.equal(createHash('sha256').update(source.content).digest('hex'),source.sha256);
   const key=randomUUID(),saved=await repo.refresh(manager,id,0,key,'Initial reference budget');
   assert.equal((await repo.refresh(manager,id,0,key,'Initial reference budget')).id,saved.id);
   await assert.rejects(repo.refresh(coordinator,id,0,randomUUID(),'Unauthorized'),/Management/);
   const safe=await repo.detail(coordinator,id);
   assert.equal(safe.history[0].snapshot.historicalSummaryBudget,undefined);
   assert.equal(safe.technical[0].snapshot.history,undefined);
   assert.ok(safe.budgets[0].snapshot.rows.every((r:any)=>r.category!=='bess'));
   assert.equal(safe.budgets[0].snapshot.combinedTemplateBudget,undefined);
   const oldSnapshot=JSON.stringify(saved.snapshot);
   const refreshed=await repo.refresh(manager,id,1,randomUUID(),'Explicit second dated budget');
   assert.equal(refreshed.version,2);assert.equal(JSON.stringify((await repo.detail(manager,id)).budgets[1].snapshot),oldSnapshot);
   await assert.rejects(db.pool.query('UPDATE ubl_budget_versions SET notes=$1 WHERE id=$2',['overwrite',saved.id]),/immutable/);
  }
  await assert.rejects(repo.list(accounts),/Commercial preparation/);
  await assert.rejects(db.pool.query("UPDATE ubl_commercial_history SET stage='Overwritten' WHERE configuration_id='20-20-30'"),/immutable/);
 }finally{await db.close();}
});
test('UBL proportional monetary markup, mixed taxes, rounding, below-cost and actual procurement savings',()=>{
 const lines=[{id:'bess',cost:'1000000',standardMarkupAmount:'300000',taxRate:'18'},{id:'earthing',cost:'45000',standardMarkupAmount:'4500',taxRate:'18'},{id:'other',cost:'100000',standardMarkupAmount:'25000',taxRate:'18'}];
 const a=allocateRemaining(lines,'1600000.01');assert.equal(a.status,'Reconciled');
 for(const l of a.lines)assert.ok(new Decimal(l.adjustedMarkupAmount).div(l.standardMarkupAmount).sub(a.factor!).abs().lt('0.000000000001'));
 const exact=a.lines.reduce((v,l)=>v.add(l.sellingExcludingTax).add(l.tax),new Decimal(0)).add(a.roundingAdjustment!);
 assert.equal(exact.toFixed(2),'1600000.01');assert.equal(a.lines[0].cost,'1000000');
 assert.equal(allocateRemaining(lines,'100').status,'Below cost');
 assert.equal(allocateRemaining([{...lines[0],standardMarkupAmount:'0'}],'1500000').status,'Zero markup pool');
 const cheaper=panelActual('900240','818400','750000');assert.equal(cheaper.saving,'68400.00');assert.ok(new Decimal(cheaper.markup!).gt(10));
 assert.equal(panelActual('900240','818400','750000',false).saving,null);
 assert.equal(panelActual('900240','818400',null).markup,null);
 assert.throws(()=>panelActual('900240','818400','-1'),/negative/);
});
