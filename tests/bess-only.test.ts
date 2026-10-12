import {quotationDisplayRows} from '../server/commercial/quotation-rows.js';
import {singlePhaseCableDescription} from '../server/boq/ac-cable.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Decimal} from 'decimal.js';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {MastersRepository} from '../server/masters/repository.js';
import {surveySchema} from '../server/boq/schema.js';
import {calculate} from '../server/boq/engine.js';
import {price,quote} from '../server/commercial/engine.js';
import {allocateDiscount} from '../server/orders/allocation.js';
import {peachtreeDivision} from '../server/orders/peachtree.js';
import {restrictedCostView} from '../server/http/cost-visibility.js';
import {BoqRepository} from '../server/boq/repository.js';
import {CommercialRepository} from '../server/commercial/repository.js';
import {OrdersRepository} from '../server/orders/repository.js';
import {pricingSchema,quotationSchema} from '../server/commercial/schema.js';
import {orderSchema} from '../server/orders/schema.js';
import {buildQuotationPdf} from '../server/commercial/report.js';
test('BESS Only: HV/LV survey and quick inputs, exact fixed charges, all six quote formats, privacy and discounted IPO/PT reconciliation',async()=>{
 const db=await testDatabase();try{
 const employee=randomUUID(),manager=randomUUID();
 for(const [id,role] of [[employee,'Coordinator'],[manager,'Management']])await db.pool.query('INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$3)',[id,id+'@example.test',role,'unused']);
 const m=await new MastersRepository(db.pool).list();
 const brand=(category:string)=>m.brands.find((b:any)=>b.category===category&&b.status==='Active')!.id;
 const row=(await db.pool.query('SELECT version,policy FROM standard_commercial_policy_versions ORDER BY version DESC LIMIT 1')).rows[0];const policy={...row.policy,version:row.version};
 for(const mode of [0,1,2])for(const quick of [false,true]){
 const sp=mode===1,dual=mode===2;
 const s=surveySchema.parse({family:'bess-only',sourceMode:quick?'General quotation':'Survey',customerId:3,siteName:`Isolated UPS fixture ${mode}`,siteCode:`UPS${mode}`,location:'Lahore',panelQty:0,panelWattage:'0',structure:'L1',dcMetres:'999',acInverter16:'10',acPanel16:'20',acInverter25:'0',acPanel25:'0',spInverterTerminationMetres:'20',spLoadPanelRunMetres:'10',earth25:'99',earth6:'10',earth10:'15',bessId:sp?'6-10':dual?'BESS-24-20':'BESS-12-20',inverter:sp?'6 kW SP':dual?'2×12 kW':'12 kW',batteryKwh:sp?10:20,smartMeter:false,genset:false,brands:{inverter:brand('Inverter'),battery:brand('Battery & BMS'),cable:brand('Cable'),switchgear:brand('Switchgear')},preparedBy:'Fixture'});
 const b=calculate(s,m as any);assert.equal(b.engineering.pvWatts,'0');assert.equal(b.engineering.strings,0);assert.equal(b.lines.find(l=>l.key==='Earthing Bore')!.qty,'1');assert.equal(b.lines.find(l=>l.key==='Labour')!.total,sp?'15000':dual?'100000':'50000');assert.equal(b.lines.find(l=>l.key==='Delivery')!.total,sp?'15000':'50000');assert.equal(b.lines.some(l=>l.phase==='Solar Panels'||l.phase==='Structure'||/DC Cable|DC Breaker|DC SPD|DC Fuse|SP DC Enclosures/.test(l.key)),false);
 if(mode!==2&&!quick){
 const br=new BoqRepository(db.pool),cr=new CommercialRepository(db.pool),orders=new OrdersRepository(db.pool);
 const draft=await br.draft(employee,undefined,0,s);const bp=await br.preview(s);const saved=await br.save(employee,draft.id,draft.version,bp.fingerprint);
 const pi=pricingSchema.parse({boqRevisionId:saved.id,presentation:'Full Breakup',taxMode:'Show Sales Tax Separately',preparedBy:'Fixture'});const pp=await cr.pricingPreview(employee,pi);const ps=await cr.pricingSave(employee,pi,pp.fingerprint,randomUUID());
 const qi=quotationSchema.parse({pricingId:ps.id,quotedDate:'2026-10-09',validity:'7 days',proposedBy:'Fixture'});const qp=await cr.quotationPreview(employee,qi);const qs=await cr.quotationSave(employee,qi,qp.fingerprint,randomUUID());
 await cr.discountReview(manager,qs.id,{discount:'11800'});
 await assert.rejects(cr.discountReview(employee,qs.id,{discount:'11800'}),/access|required/i);
 await db.pool.query("INSERT INTO coordination_events(id,quotation_id,kind,notes,created_by) VALUES($1,$2,'Submitted','Isolated test', $3)",[randomUUID(),qs.id,employee]);
 const approved=await cr.managementFinalQuotation(manager,qs.id,'11800','Isolated approval');
 const oi=orderSchema.parse({quotationId:approved.id,evidenceType:'Verbal sale confirmation',evidenceNotes:'Isolated test only',orderDate:'2026-10-09',invoiceCompany:'Fixture',salesPerson:'Fixture',customerAccepted:true});
 const op=await orders.preview(employee,oi);const submitted=await orders.submit(employee,oi,op.fingerprint,randomUUID());const issued=await orders.approve(manager,submitted.id,randomUUID());await orders.sendToAccounts(employee,issued.id);
 assert.equal((await db.pool.query('SELECT count(*) FROM ipo_accounts_handoffs WHERE ipo_id=$1',[issued.id])).rows[0].count,'1');
 assert.equal((await br.get(saved.id)).snapshot.survey.family,'bess-only');
 }
 assert.equal(b.lines.some(l=>['2.5mm² Earthing Cable',sp?'10mm² Earthing Cable':'6mm² Earthing Cable'].includes(l.key)),false);
 if(sp)assert.match(b.lines.find(l=>l.key==='10mm² 1C AC Cable')!.description,/10 m red \+ 10 m black/);
 if(sp){
 assert.equal(b.lines.some(l=>l.key==='Misc. Accessories'),false);
 const noBore=calculate({...s,spIncludeEarthingBore:false},m as any);
 assert.equal(noBore.lines.some(l=>l.key==='Earthing Bore'),false);
 assert.equal(new Decimal(b.total).sub(noBore.total).toString(),b.lines.find(l=>l.key==='Earthing Bore')!.total);
 const noBorePricing=price(noBore,'UPS',{boqRevisionId:randomUUID(),presentation:'Full Breakup',taxMode:'Show Sales Tax Separately',markups:{solar:'10',structure:'10',bess:'30',earthing:'10',balance:'25',rest:'25'},preparedBy:'Fixture',remarks:''} as any,policy);
 assert.equal(quote(noBorePricing,noBore,{pricingId:randomUUID(),quotedDate:'2026-10-09',validity:'7 days',proposedBy:'Fixture'}).lines.some(l=>l.group==='earthing'),false);
 const solar=calculate({...s,family:'solar-hybrid',panelQty:10,panelWattage:'585',brands:{...s.brands,solar:brand('Solar Panel')},spIncludeEarthingBore:false},m as any);
 for(const [key,value] of [['Labour','15000'],['Delivery','15000']])assert.equal(solar.lines.find(l=>l.key===key)!.total,value);
 assert.equal(solar.lines.some(l=>l.key==='Earthing Bore'),false);
 assert.equal(solar.lines.some(l=>l.key==='Misc. Accessories'),false);
 for(const presentation of ['Full Breakup','Basic Breakup','No Breakup'])for(const taxMode of ['Tax Included','Show Sales Tax Separately']){
 const pricing=price(solar,'SOLAR-SP',{boqRevisionId:randomUUID(),presentation,taxMode,preparedBy:'Fixture',markups:{solar:'10',structure:'10',bess:'30',earthing:'10',balance:'25',rest:'25'},remarks:''} as any,policy);
 const quoted=quote(pricing,solar,{pricingId:randomUUID(),quotedDate:'2026-10-09',validity:'7 days',proposedBy:'Fixture'});
 assert.equal(quoted.lines.some(l=>/Three Phase|High Voltage|AC SPD/.test(l.description)),false);
 if(presentation!=='No Breakup')assert.equal(quoted.lines.reduce((v,l)=>v.add(l.amount??0),new Decimal(0)).toFixed(2),taxMode==='Tax Included'?pricing.total:pricing.subtotal);
 }

 }
 const redacted=restrictedCostView(b);assert.equal(redacted.lines.filter((l:any)=>l.phase==='BESS').every((l:any)=>l.rate===null&&l.total===null),true);assert.equal(redacted.perWatt,'0.00');assert.equal(redacted.summary.some((r:any)=>r.name==='BESS'),false);
 for(const presentation of ['Full Breakup','Basic Breakup','No Breakup'])for(const taxMode of ['Tax Included','Show Sales Tax Separately']){
 const p=price(b,'UPS-R0',{boqRevisionId:randomUUID(),presentation,taxMode,markups:{solar:'10',structure:'10',bess:'30',earthing:'10',balance:'25',rest:'25'},preparedBy:'Fixture',remarks:''} as any,policy);
 assert.equal(p.solarTax,'0.00');assert.equal(p.rows.find(r=>r.key==='bess')!.markup,'30.000000');
 const q=quote(p,b,{pricingId:randomUUID(),quotedDate:'2026-10-09',validity:'7 days',proposedBy:'Fixture',discount:'11800'});
 if(presentation==='Full Breakup'){const display=quotationDisplayRows(q.lines);assert(display.every(l=>l.amount!==undefined&&l.span===1));assert.equal(display.reduce((v,l)=>v.add(l.amount!),new Decimal(0)).toFixed(2),taxMode==='Tax Included'?p.total:p.subtotal);}
 assert.equal(q.lines.some(l=>l.group==='solar'||l.group==='structure'),false);assert.equal(q.lines.filter(l=>l.group==='earthing').length,presentation==='Full Breakup'?1:0);assert.equal(q.footer.some(r=>/SOLAR PANEL/.test(r.label)),false);
 if(presentation!=='No Breakup')assert.equal(new Decimal(q.lines.reduce((v,l)=>v.add(l.amount??0),new Decimal(0))).toFixed(2),taxMode==='Tax Included'?p.total:p.subtotal);
 const detailed=quote({...p,input:{...p.input,presentation:'Full Breakup',taxMode:'Show Sales Tax Separately'}},b,{pricingId:randomUUID(),quotedDate:'2026-10-09',validity:'7 days',proposedBy:'Fixture',discount:'11800'});
 const allocation=allocateDiscount(detailed.lines.map(l=>({description:l.description,qty:l.qty,unit:l.unit,group:l.group,beforeTax:l.amount!,taxRate:'18'})),p.subtotal,p.solarTax,p.otherTax,'11800',q.footer.at(-1)!.amount);
 const pt=peachtreeDivision(allocation,b,p);assert.deepEqual(pt.phases.map(x=>x.name),['BESS','EPC']);assert.equal(new Decimal(pt.phases[0].amount).add(pt.phases[1].amount).toFixed(2),pt.phaseTotal);assert.equal(pt.ipoPayable,q.footer.at(-1)!.amount);
 assert.ok(buildQuotationPdf(q,'UPS-R0-V1').length>1000);
 }
 }
 }finally{await db.close();}
});

test('single-phase conductor descriptions explain both circuits and colour totals',()=>{
 assert.equal(singlePhaseCableDescription('20'),'10 m input + 10 m output (5 m line + 5 m neutral each). Total: 10 m red + 10 m black.');
 assert.equal(singlePhaseCableDescription('4'),'2 m input + 2 m output (1 m line + 1 m neutral each). Total: 2 m red + 2 m black.');
});
