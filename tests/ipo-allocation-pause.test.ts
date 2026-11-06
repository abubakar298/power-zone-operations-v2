import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './database.js';
import { MastersRepository } from '../server/masters/repository.js';
import { BoqRepository } from '../server/boq/repository.js';
import { surveySchema } from '../server/boq/schema.js';
import { CommercialRepository } from '../server/commercial/repository.js';
import { pricingSchema, quotationSchema } from '../server/commercial/schema.js';
import { OrdersRepository, IPO_ALLOCATION_PENDING, isPendingIpoAllocation } from '../server/orders/repository.js';
import { orderSchema } from '../server/orders/schema.js';
import { HttpError } from '../server/http/errors.js';
import {fingerprint} from '../server/boq/repository.js';

test('Atif receives a clear deferred-allocation message; repeated preview/submit cannot issue or rewrite the accepted quotation', async () => {
  const db = await testDatabase();
  try {
    const actor = randomUUID();
    await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'Atif fixture','unused','Coordinator')", [actor, `${actor}@example.test`]);
    const masters = await new MastersRepository(db.pool).list();
    const brand = (category: string) => masters.brands.find(b => b.category === category && b.status === 'Active')!.id;
    const survey = surveySchema.parse({family:'bess-only',customerId:3,siteName:'Disposable allocation fixture',siteCode:'ALLOCATION-PAUSE',location:'Lahore',panelQty:0,panelWattage:'0',structure:'L1',dcMetres:'0',earth25:'0',earth6:'0',earth10:'0',bessId:'BESS-12-20',inverter:'12 kW',batteryKwh:20,smartMeter:false,genset:false,brands:{inverter:brand('Inverter'),battery:brand('Battery & BMS'),cable:brand('Cable'),switchgear:brand('Switchgear')},preparedBy:'Atif fixture'});
    const boqs = new BoqRepository(db.pool), commercial = new CommercialRepository(db.pool), orders = new OrdersRepository(db.pool);
    const draft = await boqs.draft(actor,undefined,0,survey);
    const preview = await boqs.preview(survey);
    const boq = await boqs.save(actor,draft.id,draft.version,preview.fingerprint);
    const input = pricingSchema.parse({boqRevisionId:boq.id,presentation:'Full Breakup',taxMode:'Show Sales Tax Separately',preparedBy:'Atif fixture'});
    const pricingPreview = await commercial.pricingPreview(actor,input);
    const modernPricing = await commercial.pricingSave(actor,input,pricingPreview.fingerprint,randomUUID());
    // Preserve an actual legacy snapshot shape, rather than expecting new verified allocations to pause.
    const {discountStrategy,sellingDiscountReview,...legacySnapshot}=modernPricing.snapshot;
    const legacyId=randomUUID();
    await db.pool.query("INSERT INTO commercial_pricing_versions(id,boq_revision_id,version,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,2,'LEGACY-ALLOCATION-FIXTURE',$3,$4,$5,$6)",[legacyId,boq.id,{...legacySnapshot,engineVersion:3},fingerprint({...legacySnapshot,engineVersion:3}),randomUUID(),actor]);
    const pricing={id:legacyId};
    const qi = quotationSchema.parse({pricingId:pricing.id,quotedDate:'2026-10-14',validity:'7 Days',proposedBy:'Atif fixture'});
    const qp = await commercial.quotationPreview(actor,qi);
    const quote = await commercial.quotationSave(actor,qi,qp.fingerprint,randomUUID());
    for (const kind of ['Submitted','Approved']) await db.pool.query("INSERT INTO coordination_events(id,quotation_id,kind,notes,created_by) VALUES($1,$2,$3,'Isolated accepted quotation fixture',$4)",[randomUUID(),quote.id,kind,actor]);
    const order = orderSchema.parse({quotationId:quote.id,evidenceType:'Verbal sale confirmation',evidenceNotes:'Disposable test only',orderDate:'2026-10-14',invoiceCompany:'PZ fixture',salesPerson:'Atif fixture',customerAccepted:true});
    const count = async () => (await db.pool.query('SELECT (SELECT count(*) FROM internal_purchase_orders) AS ipos,(SELECT count(*) FROM customer_purchase_orders) AS pos,(SELECT count(*) FROM ipo_submissions) AS submissions,(SELECT count(*) FROM document_reference_roots) AS references')).rows[0];
    const before = await count();
    for (let attempt=0;attempt<2;attempt++) {
      await assert.rejects(orders.preview(actor,order), e => isPendingIpoAllocation(e) && (e as Error).message === IPO_ALLOCATION_PENDING);
      await assert.rejects(orders.submit(actor,order,'not-a-valid-preview',randomUUID()), e => isPendingIpoAllocation(e));
    }
    assert.deepEqual(await count(),before);
    assert.deepEqual((await commercial.quotationGet(quote.id)).snapshot,quote.snapshot);
  } finally { await db.close(); }
});

test('only known allocation incompatibilities are classified as deferred', () => {
  assert.equal(isPendingIpoAllocation(new HttpError(422,'Quotation totals do not reconcile with its approved selling amounts.')),true);
  assert.equal(isPendingIpoAllocation(new HttpError(403,'Forbidden')),false);
  assert.equal(isPendingIpoAllocation(new HttpError(422,'Invalid approved quotation selling lines.')),false);
  assert.equal(isPendingIpoAllocation(new Error('Database connection failed')),false);
});
