import{test}from'node:test';
import assert from'node:assert/strict';
import{randomUUID}from'node:crypto';
import{Decimal}from'decimal.js';
import{testDatabase}from'./database.js';
import{MastersRepository}from'../server/masters/repository.js';
import{BoqRepository,fingerprint}from'../server/boq/repository.js';
import{surveySchema}from'../server/boq/schema.js';
import{CommercialRepository}from'../server/commercial/repository.js';
import{pricingSchema,quotationSchema}from'../server/commercial/schema.js';
import{OrdersRepository}from'../server/orders/repository.js';
import{orderSchema}from'../server/orders/schema.js';
import{ptDisplayRows}from'../server/orders/pt-detail.js';
import{restrictedCostView}from'../server/http/cost-visibility.js';
import{discountedSellingReview}from'../server/commercial/engine.js';
import{DISCOUNT_POLICY}from'../server/commercial/discount-strategy.js';
test('all 12 presentation/tax/cash variants carry approved and special discounts from accepted quote to IPO/PT without changing masters',async()=>{
 const db=await testDatabase();try{
  const actor=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Atif variant fixture','Coordinator','unused')",[actor,actor+'@test.invalid']);
  const masters=await new MastersRepository(db.pool).list(),brand=(c:string)=>masters.brands.find(b=>b.category===c&&b.status==='Active')!.id;
  const protectedBefore=JSON.stringify({rates:masters.rates,rules:masters.rules,catalogue:masters.catalogue,profiles:masters.engineeringProfiles});
  const boqs=new BoqRepository(db.pool),commercial=new CommercialRepository(db.pool),orders=new OrdersRepository(db.pool);
  const survey=surveySchema.parse({customerId:3,siteName:'Isolated allocation variants',siteCode:'DISCOUNT-VARIANTS',location:'Isolated',panelQty:20,panelWattage:'550',structure:'Elevated',dcMetres:'100',earth25:'20',earth6:'30',earth10:'30',inverter:'12 kW',batteryKwh:20,smartMeter:false,genset:false,brands:{solar:brand('Solar Panel'),inverter:brand('Inverter'),battery:brand('Battery & BMS'),cable:brand('Cable'),switchgear:brand('Switchgear')},preparedBy:'Atif fixture'});
  let checks=0;
  for(const legacy of [false,true])for(const presentation of ['No Breakup','Basic Breakup','Full Breakup'])for(const variant of [{saleType:'Tax Deal',taxMode:'Tax Included'},{saleType:'Tax Deal',taxMode:'Show Sales Tax Separately'},{saleType:'Cash Deal',taxMode:'Tax Included',cashGstTreatment:'No GST added'},{saleType:'Cash Deal',taxMode:'Tax Included',cashGstTreatment:'Included in selling price'}])for(const adjustment of [{discountMode:'Pre-approved'},{discountMode:'Custom',discountPercent:'10'}]){
   const siteSurvey={...survey,siteCode:'DISCOUNT-VARIANTS-'+checks},draft=await boqs.draft(actor,undefined,0,siteSurvey),bp=await boqs.preview(siteSurvey),boq=await boqs.save(actor,draft.id,draft.version,bp.fingerprint);
   const input=pricingSchema.parse({boqRevisionId:boq.id,presentation,...variant,...adjustment,preparedBy:'Atif fixture'});
   const pp=await commercial.pricingPreview(actor,input);let pricing=await commercial.pricingSave(actor,input,pp.fingerprint,randomUUID());
   assert.equal(pricing.snapshot.engineVersion,5);
   if(legacy){const {discountStrategy,sellingDiscountReview,...old}=pricing.snapshot,snapshot={...old,engineVersion:4},id=randomUUID();await db.pool.query('INSERT INTO commercial_pricing_versions(id,boq_revision_id,version,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,2,$3,$4,$5,$6,$7)',[id,boq.id,'LEGACY-'+checks,snapshot,fingerprint(snapshot),randomUUID(),actor]);pricing={...pricing,id,snapshot:snapshot as any};}
   const redacted=restrictedCostView(pricing.snapshot,true);assert.equal(redacted.discountStrategy,undefined);
   const visible=discountedSellingReview(redacted),internal=discountedSellingReview(pricing.snapshot);assert.equal(visible.netTotal,internal.netTotal);assert.deepEqual(visible.rows.map(r=>r.discountAmount),internal.rows.map(r=>r.discountAmount));
   const qi=quotationSchema.parse({pricingId:pricing.id,quotedDate:'2026-10-15',validity:'7 Days',proposedBy:'Atif fixture'}),qp=await commercial.quotationPreview(actor,qi),q=await commercial.quotationSave(actor,qi,qp.fingerprint,randomUUID());
   const accepted=q.snapshot.discountAllocation;if(!legacy){assert.equal(accepted.policy,DISCOUNT_POLICY);assert.ok(accepted.lines.every((l:any)=>l.cost===undefined&&l.approvedAllowance===undefined));}
   const before=JSON.stringify(q.snapshot);
   for(const kind of ['Submitted','Approved'])await db.pool.query("INSERT INTO coordination_events(id,quotation_id,kind,notes,created_by,created_at) VALUES($1,$2,$3,'Disposable accepted fixture',$4,now()+CASE WHEN $3='Approved' THEN interval '2 seconds' ELSE interval '1 second' END)",[randomUUID(),q.id,kind,actor]);
   const oi=orderSchema.parse({quotationId:q.id,evidenceType:'Verbal sale confirmation',evidenceNotes:'Disposable test only',orderDate:'2026-10-15',invoiceCompany:variant.saleType==='Cash Deal'?'Energy Solutions':'PZES',salesPerson:'Atif fixture',customerAccepted:true});
   const preview=await orders.preview(actor,oi),allocation=preview.snapshot.allocation,pt=preview.snapshot.peachtree;
   assert.equal(allocation.total,q.snapshot.footer.find((r:any)=>r.label==='Net Total').amount);
   assert.equal(new Decimal(allocation.subtotal).add(allocation.tax).toFixed(2),allocation.total);
   const ptRows=ptDisplayRows(pt),phaseTotal=ptRows.reduce((s:Decimal,r:any)=>s.add(r.amount),new Decimal(0));
   assert.equal(phaseTotal.toFixed(2),pt.phaseTotal);
   assert.equal(phaseTotal.add(pt.taxMode==='Tax Included'?0:pt.ipoTax).toFixed(2),allocation.total);
   if(!legacy){
   const protectedLines=allocation.lines.filter((l:any)=>['solar','structure','earthing'].includes(l.group));assert.ok(protectedLines.every((l:any)=>l.managementSpecialDiscount==='0.00'));
   assert.ok(ptRows.filter((r:any)=>['Solar Panels','Structure','Earthing'].includes(r.name)).every((r:any)=>!r.managementSpecialDiscount||r.managementSpecialDiscount==='0.00'));
   assert.equal(allocation.lines.reduce((s:Decimal,l:any)=>s.add(l.approvedDiscount),new Decimal(0)).toFixed(2),accepted.approvedDiscount);
   assert.equal(allocation.lines.reduce((s:Decimal,l:any)=>s.add(l.managementSpecialDiscount),new Decimal(0)).toFixed(2),accepted.managementSpecialDiscount);
   }else assert.equal(allocation.policy,'accepted-before-tax-discount-v2');
   if(variant.saleType==='Cash Deal')assert.equal(allocation.tax,'0.00');
   assert.equal(JSON.stringify((await commercial.quotationGet(q.id)).snapshot),before);
   checks++;
  }
  assert.equal(checks,48);
  const after=await new MastersRepository(db.pool).list();assert.equal(JSON.stringify({rates:after.rates,rules:after.rules,catalogue:after.catalogue,profiles:after.engineeringProfiles}),protectedBefore);
  assert.equal((await db.pool.query('SELECT count(*) AS n FROM internal_purchase_orders')).rows[0].n,'0');
 }finally{await db.close();}
});
