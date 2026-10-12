import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Decimal} from 'decimal.js';
import {testDatabase} from './database.js';
import {MastersRepository} from '../server/masters/repository.js';
import {calculate} from '../server/boq/engine.js';
import {surveySchema} from '../server/boq/schema.js';
import {selectCatalogueItem} from '../server/masters/catalogue.js';
import {restrictedCostView} from '../server/http/cost-visibility.js';
import {price,quote} from '../server/commercial/engine.js';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
test('approved catalogue: exact brand identity, shared cable rates, standard/UPS scopes and immutable versions',async()=>{
 const db=await testDatabase();try{
 const repo=new MastersRepository(db.pool);const m=await repo.list();assert.equal(m.catalogue.length,126);
 assert.deepEqual(await repo.history('rates','CH-CBL-ERT-10MM/1C-PK'),await repo.history('rates','10mm² Earthing Cable'));
 assert.deepEqual(await repo.history('rates','CH-Cable-6mm 1/C AC'),await repo.history('rates','CH-CBL-AC-6MM/1C-RB-AOB'));
 const brand=(category:string,name?:string)=>m.brands.find((b:any)=>b.category===category&&b.status==='Active'&&(!name||b.name===name))!.id;
 const survey=surveySchema.parse({customerId:3,siteName:'Isolated master fixture',siteCode:'MASTER01',location:'Lahore',panelQty:12,panelWattage:'620',structure:'Elevated',dcMetres:'100',earth25:'12',earth6:'25',earth10:'25',spLoadPanelRunMetres:'20',sourceMode:'General quotation',inverter:'6 kW SP',bessId:'6-10',batteryKwh:10,smartMeter:false,genset:false,preparedBy:'Test',brands:{solar:brand('Solar Panel','Any of the Above'),inverter:brand('Inverter'),battery:brand('Battery & BMS'),cable:brand('Cable','Pakistan Cables'),switchgear:brand('Switchgear','CHINT')}});
 const sp=calculate(survey,m);const find=(s:any,k:string)=>s.lines.find((l:any)=>l.key===k);
 assert.equal(sp.engineering.strings,2);assert.equal(find(sp,'500V 2P DC Breaker').qty,'4');assert.equal(find(sp,'DC SPD').qty,'2');assert.equal(find(sp,'DC Fuse with Holder').qty,'2');assert.equal(find(sp,'Earthing Bore').qty,'2');assert.equal(find(sp,'Misc. Accessories'),undefined);assert.equal(find(sp,'Labour').total,'15000');assert.equal(find(sp,'Delivery').total,'15000');
 assert.equal(find(sp,'10mm² 1C AC Cable').itemId,'CH-CBL-AC-10MM/1C-RB');assert.equal(find(sp,'10mm² Earthing Cable').itemId,'CH-CBL-ERT-10MM/1C-PK');assert.equal(find(sp,'6mm² DC Cable Red').itemId,find(sp,'6mm² DC Cable Black').itemId);
 for(const brandName of ['Pakistan Cables','Newage Cables','Any of the Above']){
  const item=selectCatalogueItem(m,'2.5mm² Earthing Cable',brandName)!;
  assert.equal(item.rate_key,'2.5mm² Earthing Cable');assert.equal(item.payload.brandCategory,brandName==='Any of the Above'?'All other cables':brandName);
 }
 assert.equal(selectCatalogueItem(m,'16mm² 4C AC Cable','Newage Cables'),undefined,'never substitute Pakistan for missing Newage');
 assert.equal(selectCatalogueItem(m,'16mm² 4C AC Cable','Any of the Above')!.item_id,'CH-CBL-AC-16MM/4C-AOB');
 assert.equal(selectCatalogueItem(m,'25mm² 4C AC Cable','Any of the Above')!.item_id,'CH-CBL-AC-25MM/4C-AOB');
 for(const kw of [10,12,15,20]){
  const s=calculate({...survey,bessId:undefined,inverter:`${kw} kW`,batteryKwh:20},m);assert.equal(find(s,'63A 4P Changeover').qty,'1');assert.equal(find(s,'100A Rotary Changeover with Box'),undefined);assert.equal(find(s,'63A 4P MCB').qty,'2');assert.equal(find(s,'AC & DC Boxes').qty,'1');assert.equal(find(s,'Misc. Accessories').qty,'1');assert.equal(find(s,'16mm² 4C AC Cable').qty,'30');
 }
 const dual=calculate({...survey,bessId:undefined,inverter:'2×15 kW',batteryKwh:40},m);assert.equal(find(dual,'63A 4P MCB').qty,'4');assert.equal(find(dual,'100A 4P MCCB').qty,'2');assert.equal(find(dual,'16mm² 4C AC Cable').qty,'15');assert.equal(find(dual,'25mm² 4C AC Cable').qty,'20');assert.equal(find(dual,'100A Rotary Changeover with Box').stockBrand,'OPAL');
 const policyRow=(await db.pool.query('SELECT version,policy FROM standard_commercial_policy_versions ORDER BY version DESC LIMIT 1')).rows[0];const policy={...policyRow.policy,version:policyRow.version};
 for(const [customer,kwh,cableId] of [['MBL',5,'CH-CBL-AC-6MM/1C-RB-NA'],['MBL',10,'CH-CBL-AC-6MM/1C-RB-NA'],['UBL',10,'CH-CBL-AC-10MM/1C-RB']] as const){
  const customerId=m.customers.find(c=>c.short_code===customer)!.id;
  const s=calculate({...survey,family:'bess-only',customerId,batteryKwh:kwh,bessId:`6-${kwh}`,panelQty:0,panelWattage:'0'},m);
  assert.equal(s.lines.length,9);assert.equal(find(s,'BAT-LV-05 KW WO BMS').qty,String(kwh/5));assert.equal(find(s,'CH-BMS-LV').qty,'1');assert.equal(s.lines.find(l=>l.itemId===cableId)!.qty,'4');assert.equal(find(s,'2.5mm² Earthing Cable').qty,'1');assert.equal(find(s,'CH-5WAY-DB').qty,'1');assert.equal(find(s,'Labour').total,'5000');assert.equal(find(s,'Delivery').total,'5000');assert(!s.lines.some(l=>/Earthing Bore|MCB|Changeover|DC Cable|Misc/.test(l.key)));
  assert.equal(s.lines.find(l=>l.itemId===cableId)!.stockBrand,customer==='MBL'?'Newage Cables':'Pakistan Cables');
  const p=price(s,'UPS',{boqRevisionId:randomUUID(),presentation:'Full Breakup',taxMode:'Show Sales Tax Separately',preparedBy:'Test'} as any,policy);assert(p.total);
  for(const presentation of ['Full Breakup','Basic Breakup','No Breakup'] as const){const priced=price(s,'UPS',{boqRevisionId:randomUUID(),presentation,taxMode:'Show Sales Tax Separately',preparedBy:'Test'} as any,policy);const quotation=quote(priced,s,{pricingId:randomUUID(),quotedDate:'2026-10-12',validity:'7 days',proposedBy:'Test'});assert(quotation.footer.at(-1)?.amount);}
  assert(new Decimal(s.total).eq(s.lines.reduce((v,l)=>v.plus(l.total),new Decimal(0))));
 }
 assert.throws(()=>calculate({...survey,family:'bess-only',customerId:5,bessId:'6-5',batteryKwh:5},m),/customer-approved/);
 assert.equal((await db.pool.query('SELECT count(*) FROM customer_order_reference_history')).rows[0].count,'3');
 const allRates=m.rates;const safe=restrictedCostView({rates:allRates});assert(!safe.rates.some((r:any)=>/^CH-PCS-|^CH-BAT-|^HYB-|^BAT-/.test(r.key)));assert(safe.rates.some((r:any)=>r.key==='CH-CBL-AC-6MM/1C-RB-AOB'));
 await assert.rejects(db.pool.query("UPDATE inventory_catalogue_versions SET payload='{}'"),/immutable/);await assert.rejects(db.pool.query("DELETE FROM engineering_profile_versions"),/immutable/);
 const migration=await readFile('migrations/057_inventory_catalogue_rules.sql','utf8');assert(!/UPDATE\s+(ubl_|boq_|accounts_|inventory_report)|DELETE\s+FROM\s+(ubl_|boq_|accounts_|inventory_report)/i.test(migration));
 }finally{await db.close();}
});
