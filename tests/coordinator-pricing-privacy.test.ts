import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import request from 'supertest';
import {testDatabase} from './database.js';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import {BoqRepository} from '../server/boq/repository.js';
import {MastersRepository} from '../server/masters/repository.js';
import {surveySchema} from '../server/boq/schema.js';
import {pricingSchema,quotationSchema} from '../server/commercial/schema.js';
import {CommercialRepository} from '../server/commercial/repository.js';
import {coordinationPricingView,restrictedCostView} from '../server/http/cost-visibility.js';
import {discountedSellingReview} from '../server/commercial/engine.js';
test('Coordination policy projection retains selling/discount results without exposing standards or mutating history',()=>{
 const original={policy:{version:3,markups:{solar:'10'},costUpliftPercent:'5'},input:{markups:{solar:'10'},remarks:'Keep'},itemPricing:[{cost:'100',markup:'10'}],history:[{policy:{markups:{other:'25'}}}],discountAllocation:{policy:'accepted-discount-v2',approvedDiscount:'10'},rows:[{key:'solar',markup:'10',beforeTax:'110'}],total:'110',created_at:new Date('2026-10-30T00:00:00Z')};
 const before=structuredClone(original),safe=coordinationPricingView(original);assert.equal(safe.policy,undefined);assert.equal(safe.input.markups,undefined);assert.equal(safe.itemPricing,undefined);assert.equal(safe.history[0].policy,undefined);assert.equal(safe.rows[0].markup,undefined);assert.equal(safe.total,'110');assert.equal(safe.discountAllocation.policy,'accepted-discount-v2');assert.deepEqual(original,before);
});
test('Coordinator cannot GET policy, but previews, saves, reloads and prepares quotations using unchanged server prices',async()=>{
 const db=await testDatabase();try{
 const actor=randomUUID(),token=randomBytes(32).toString('base64url'),csrf='fictional-pricing-csrf',origin='http://localhost:3000';
 await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,'Fictional Coordinator','Coordinator','unused')",[actor,actor+'@test.invalid']);
 await db.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),actor,csrf]);
 const app=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:origin,DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'isolated-pricing-setup-123456789'})),cookie='pz_session='+token;
 const post=(path:string,input:any)=>request(app).post(path).set('Cookie',cookie).set('Origin',origin).set('X-CSRF-Token',csrf).send(input);
 await request(app).get('/api/commercial/standard-policy').set('Cookie',cookie).expect(403);
 const m=await new MastersRepository(db.pool).list(),brand=(c:string)=>m.brands.find(b=>b.category===c&&b.status==='Active')!.id;
 const b=new BoqRepository(db.pool),repo=new CommercialRepository(db.pool),survey=surveySchema.parse({customerId:3,siteName:'Fictional privacy check',siteCode:'POLICY-PRIVATE',location:'Isolated',panelQty:20,panelWattage:'550',structure:'Elevated',dcMetres:'100',earth25:'20',earth6:'30',earth10:'30',inverter:'12 kW',batteryKwh:20,smartMeter:false,genset:false,brands:{solar:brand('Solar Panel'),inverter:brand('Inverter'),battery:brand('Battery & BMS'),cable:brand('Cable'),switchgear:brand('Switchgear')},preparedBy:'Fixture'});
 const sourceBefore=(await db.pool.query('SELECT policy FROM standard_commercial_policy_versions ORDER BY version')).rows;
 for(const presentation of ['No Breakup','Basic Breakup','Full Breakup']){
 const siteSurvey={...survey,siteCode:'POLICY-'+presentation.replaceAll(' ','-')},draft=await b.draft(actor,undefined,0,siteSurvey),bp=await b.preview(siteSurvey),boq=await b.save(actor,draft.id,draft.version,bp.fingerprint);
 const input=pricingSchema.parse({boqRevisionId:boq.id,presentation,taxMode:'Show Sales Tax Separately',discountMode:'Pre-approved',preparedBy:'Fictional Coordinator'}),internal=await repo.pricingPreview(actor,input),preview=(await post('/api/commercial/pricing/preview',input).expect(200)).body;
 assert.equal(preview.snapshot.policy,undefined);assert.equal(preview.snapshot.input.markups,undefined);assert.equal(preview.snapshot.itemPricing,undefined);assert.equal(preview.snapshot.rows.some((r:any)=>r.markup!==undefined),false);assert.equal(preview.snapshot.netTotal,internal.snapshot.netTotal);assert.equal(preview.fingerprint,internal.fingerprint);
 assert.equal(discountedSellingReview(preview.snapshot).netTotal,discountedSellingReview(restrictedCostView(internal.snapshot,true)).netTotal);
 const pricing=(await post('/api/commercial/pricing',{...input,fingerprint:preview.fingerprint,requestKey:randomUUID()}).expect(201)).body;
 const saved=(await request(app).get('/api/commercial/pricing/'+pricing.id).set('Cookie',cookie).expect(200)).body;assert.equal(saved.snapshot.policy,undefined);
 const qi=quotationSchema.parse({pricingId:pricing.id,quotedDate:'2026-10-30',validity:'7 Days',proposedBy:'Fictional Coordinator'}),qp=(await post('/api/commercial/quotations/preview',qi).expect(200)).body;
 const q=(await post('/api/commercial/quotations',{...qi,fingerprint:qp.fingerprint,requestKey:randomUUID()}).expect(201)).body;assert.ok(q.id);assert.equal(q.snapshot.pricing?.policy,undefined);
 }
 assert.deepEqual((await db.pool.query('SELECT policy FROM standard_commercial_policy_versions ORDER BY version')).rows,sourceBefore);
 }finally{await db.close();}
});
