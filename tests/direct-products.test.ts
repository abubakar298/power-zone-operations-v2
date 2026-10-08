import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {testDatabase} from './database.js';
import {MastersRepository} from '../server/masters/repository.js';
import {surveySchema} from '../server/boq/schema.js';
import {calculate} from '../server/boq/engine.js';
import {price,quote} from '../server/commercial/engine.js';
import {restrictedCostView} from '../server/http/cost-visibility.js';
import {allocateDiscount} from '../server/orders/allocation.js';
import {peachtreeDivision} from '../server/orders/peachtree.js';
import {BoqRepository} from '../server/boq/repository.js';
import {CommercialRepository} from '../server/commercial/repository.js';
import {OrdersRepository} from '../server/orders/repository.js';
import {pricingSchema,quotationSchema} from '../server/commercial/schema.js';
import {orderSchema} from '../server/orders/schema.js';
import {buildQuotationPdf} from '../server/commercial/report.js';
import {quotationDisplayRows} from '../server/commercial/quotation-rows.js';
test('Direct Product Sale uses approved equipment, policy prices, safe visibility and the existing quotation-to-IPO workflow',async()=>{
 const db=await testDatabase();try{
 const employee=randomUUID(),manager=randomUUID();
 for(const [id,role] of [[employee,'Coordinator'],[manager,'Management']])await db.pool.query('INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)',[id,`${id}@example.test`,'Fixture','not-a-login-hash',role]);
 const masters=new MastersRepository(db.pool);const m=await masters.list();const policyRow=(await db.pool.query("SELECT version,policy FROM standard_commercial_policy_versions ORDER BY version DESC LIMIT 1")).rows[0];const policy={...policyRow.policy,version:policyRow.version};
 const s=surveySchema.parse({family:'direct-product',customerId:3,siteName:'Isolated product fixture',siteCode:'PRODUCT',location:'',panelQty:0,panelWattage:'0',structure:'L1',dcMetres:'0',earth25:'0',earth6:'0',earth10:'0',inverter:'Products',batteryKwh:0,brands:{},smartMeter:false,genset:false,preparedBy:'Fixture',directProducts:[{kind:'bess',key:'6-10',qty:'2'},{kind:'item',key:'BAT-LV-05 KW WO BMS',qty:'1'},{kind:'item',key:'Extra Smart Meter',qty:'3'}]});
 const b=calculate(s,m as any);
 assert.equal(b.lines.find(l=>l.key==='HYB-SP-006')!.qty,'2');assert.equal(b.lines.find(l=>l.key==='BAT-LV-05 KW WO BMS')!.qty,'5');assert.equal(b.lines.find(l=>l.key==='CH-BMS-LV')!.qty,'2');
 assert.equal(b.lines.length,4);assert.equal(b.lines.some(l=>/Labour|Delivery|Cable|Bore|Structure/.test(l.key)),false);
 const safe=restrictedCostView(b);assert.equal(safe.lines.filter((l:any)=>l.phase==='BESS').every((l:any)=>l.rate===null&&l.total===null),true);assert.equal(safe.total,b.lines.find(l=>l.key==='Extra Smart Meter')!.total);
 const hv=calculate({...s,directProducts:[{kind:'bess',key:'BESS-24-40',qty:'2'}]},m as any);assert.equal(hv.lines.find(l=>l.key==='HYB-3P-012')!.qty,'4');assert.equal(hv.lines.find(l=>l.key==='BAT-HV-05 KW WO BMS')!.qty,'16');assert.equal(hv.lines.find(l=>l.key==='CH-BMS-HV')!.qty,'4');
 const individual=calculate({...s,directProducts:[{kind:'item',key:'Extra Smart Meter',qty:'1'}]},m as any);assert.equal(individual.lines.length,1);assert.equal(individual.lines[0].phase,'EPC');
 assert.throws(()=>calculate({...s,directProducts:[{kind:'item',key:'FORGED',qty:'1'}]},m as any),/active item/);
 assert.throws(()=>calculate({...s,directProducts:[{kind:'bess',key:'6-10',qty:'1.5'}]},m as any),/whole/);
 assert.throws(()=>calculate({...s,directProducts:[{kind:'item',key:'Delivery',qty:'1'}]},m as any),/products only/);
 for(const presentation of ['No Breakup','Full Breakup'] as const)for(const taxMode of ['Tax Included','Show Sales Tax Separately'] as const)for(const groupBessPackages of [false,true]){
 const pi=pricingSchema.parse({boqRevisionId:randomUUID(),presentation,taxMode,groupBessPackages,preparedBy:'Fixture'});const p=price(b,'PRODUCT-R0',pi,policy);
 assert.equal(p.itemPricing!.find(l=>l.key==='HYB-SP-006')!.markup,'30');assert.equal(p.itemPricing!.find(l=>l.key==='Extra Smart Meter')!.markup,'25');
 const q=quote(p,b,{pricingId:randomUUID(),quotedDate:'2026-10-09',validity:'7 days',proposedBy:'Fixture',discount:'11800'});
 assert.equal(q.lines.length,5);assert.equal(q.lines[0].qty,'2');assert.equal(q.lines[1].qty,'4');assert.equal(q.lines[3].qty,'1');
 if(presentation==='Full Breakup'){assert.equal(q.lines.reduce((sum,l)=>sum.add(l.amount??0),new Decimal(0)).toFixed(2),taxMode==='Tax Included'?p.total:p.subtotal);assert.equal(q.lines[0].span,groupBessPackages?3:1);assert.equal(q.lines[3].span,1);}else assert.equal(q.lines.some(l=>l.amount!==undefined),false);
 if(taxMode==='Tax Included')assert.equal(q.footer.some(l=>/tax|GST/i.test(l.label)),false);
 assert.equal(quotationDisplayRows(q.lines).some(l=>/\(\d+ (Each|Metre|No\.)\)/.test(l.description)),false);
 const allocation=allocateDiscount(p.itemPricing!.map(l=>{const source=b.lines.find(x=>x.key===l.key)!;return {description:source.key,qty:source.qty,unit:source.unit,group:l.group,beforeTax:l.beforeTax,taxRate:l.taxRate};}),p.subtotal,p.solarTax,p.otherTax,'11800',q.footer.at(-1)!.amount);
 const pt=peachtreeDivision(allocation,b,p);assert.equal(pt.phaseTotal,taxMode==='Tax Included'?allocation.total:allocation.subtotal);assert.equal(pt.phases.find(x=>x.name==='Inverter')!.amount=== '0.00',false);assert.equal(pt.phases.find(x=>x.name==='Batteries')!.amount=== '0.00',false);assert.equal(pt.ipoPayable,q.footer.at(-1)!.amount);
 assert.ok(buildQuotationPdf(q,'PRODUCT-R0-V1').length>1000);
 }
 assert.throws(()=>price(b,'PRODUCT',pricingSchema.parse({boqRevisionId:randomUUID(),presentation:'Basic Breakup',taxMode:'Tax Included',preparedBy:'Fixture'}),policy),/No Breakup or Breakup/);
 const unclassified={...policy,itemCategories:{...policy.itemCategories}};delete unclassified.itemCategories['Extra Smart Meter'];assert.throws(()=>price(b,'PRODUCT',pricingSchema.parse({boqRevisionId:randomUUID(),presentation:'Full Breakup',taxMode:'Tax Included',preparedBy:'Fixture'}),unclassified),/classification required/);
 const br=new BoqRepository(db.pool),cr=new CommercialRepository(db.pool),orders=new OrdersRepository(db.pool);
 const draft=await br.draft(employee,undefined,0,s);const bp=await br.preview(s);const saved=await br.save(employee,draft.id,draft.version,bp.fingerprint);
 const pi=pricingSchema.parse({boqRevisionId:saved.id,presentation:'Full Breakup',taxMode:'Show Sales Tax Separately',groupBessPackages:true,preparedBy:'Fixture'});const pp=await cr.pricingPreview(employee,pi);const ps=await cr.pricingSave(employee,pi,pp.fingerprint,randomUUID());
 const qi=quotationSchema.parse({pricingId:ps.id,quotedDate:'2026-10-09',validity:'7 days',proposedBy:'Fixture'});const qp=await cr.quotationPreview(employee,qi);const qs=await cr.quotationSave(employee,qi,qp.fingerprint,randomUUID());
 await assert.rejects(cr.discountReview(employee,qs.id,{discount:'11800'}),/access|required/i);await cr.discountReview(manager,qs.id,{discount:'11800'});
 await db.pool.query("INSERT INTO coordination_events(id,quotation_id,kind,notes,created_by) VALUES($1,$2,'Submitted','Isolated fixture',$3)",[randomUUID(),qs.id,employee]);const approved=await cr.managementFinalQuotation(manager,qs.id,'11800','Fixture approval');
 const oi=orderSchema.parse({quotationId:approved.id,evidenceType:'Verbal sale confirmation',evidenceNotes:'Isolated fixture',orderDate:'2026-10-09',invoiceCompany:'Fixture',salesPerson:'Fixture',customerAccepted:true});const op=await orders.preview(employee,oi);const submitted=await orders.submit(employee,oi,op.fingerprint,randomUUID());const issued=await orders.approve(manager,submitted.id,randomUUID());await orders.sendToAccounts(employee,issued.id);
 assert.equal((await db.pool.query('SELECT count(*) FROM ipo_accounts_handoffs WHERE ipo_id=$1',[issued.id])).rows[0].count,'1');assert.equal((await br.get(saved.id)).snapshot.survey.family,'direct-product');
 }finally{await db.close();}
});
