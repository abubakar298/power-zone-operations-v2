import {test} from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import {financialVisibility,restrictedCostView,canSeeBessCost,isBessEquipment} from "../server/http/cost-visibility.js";
const boq={survey:{siteName:"Fixture"},engineering:{pvWatts:"1000"},lines:[{key:"HYB-3P-012",phase:"BESS",qty:"1",rate:"363076",total:"363076"},{key:"Cable",phase:"EPC",qty:"10",rate:"100",total:"1000"}],summary:[{name:"BESS",cost:"363076",perWatt:"363.076"},{name:"EPC",cost:"1000",perWatt:"1"}],total:"364076",perWatt:"364.08"};
const pricing={cost:"364076",profit:"109000",input:{markups:{bess:"30",balance:"25"}},policy:{version:1,markups:{bess:"30",other:"25"}},rows:[{key:"bess",cost:"363076",markup:"30",beforeTax:"472998.8"},{key:"balance",cost:"1000",markup:"25",beforeTax:"1250"}],netTotal:"559613.58"};
test("BOQ projection keeps equipment, removes BESS rates and recomputes only the permitted total without modifying snapshots",()=>{
 const before=JSON.stringify(boq),v=restrictedCostView({snapshot:boq});assert.equal(v.snapshot.total,"1000");assert.equal(v.snapshot.costVisibility,"Excluding BESS");assert.equal(v.snapshot.lines[0].rate,null);assert.equal(v.snapshot.lines[0].total,null);assert.equal(v.snapshot.lines[0].qty,"1");assert.equal(v.snapshot.lines[1].rate,"100");assert.equal(v.snapshot.summary.length,1);assert.equal(JSON.stringify(boq),before);
});
test("pricing projection preserves non-BESS review and selling totals while removing BESS costs, markup and overall profit",()=>{
 const v=restrictedCostView(pricing,true);assert.equal(v.cost,undefined);assert.equal(v.profit,undefined);assert.equal(v.rows[0].cost,null);assert.equal(v.rows[0].markup,null);assert.equal(v.rows[0].beforeTax,"472998.8");assert.equal(v.rows[1].cost,"1000");assert.equal(v.rows[1].markup,"25");assert.equal(v.input.markups.bess,undefined);assert.equal(v.policy.markups.bess,undefined);assert.equal(v.netTotal,pricing.netTotal);assert.equal(restrictedCostView({budgeted_markup:'21.75'}).budgeted_markup,undefined);
});
test("outbound HTTP boundary uses authenticated role at send time, including history, pricing, masters and nested handoffs",async()=>{
 const app=express();app.use(financialVisibility);app.use((req,_res,next)=>{(req as any).authSession={user:{role:req.get("X-Fixture-Role"),restrictedCostAccess:req.get("X-Fixture-Cost-Access")==="yes"}};next();});
 app.get('/api/boqs/:id',(_req,res)=>res.json({snapshot:boq}));app.get('/api/boqs/:id/history',(_req,res)=>res.json({revisions:[{id:'original',total:'364076'}]}));app.get('/api/commercial/pricing/:id',(_req,res)=>res.json({snapshot:pricing}));app.get('/api/masters',(_req,res)=>res.json({rates:[{key:'BAT-HV-05 KW WO BMS',rate:'231962'},{key:'Cable',rate:'100'}]}));app.get('/api/operations/source',(_req,res)=>res.json({nested:{snapshot:boq}}));
 for(const role of ['Coordinator','Operations','Design','Employee']){
  const get=(path:string)=>request(app).get(path).set('X-Fixture-Role',role);
  assert.equal((await get('/api/boqs/fixture')).body.snapshot.lines[0].rate,null);
  assert.equal((await get('/api/boqs/fixture/history')).body.revisions[0].total,undefined);
  assert.equal((await get('/api/commercial/pricing/fixture')).body.snapshot.rows[0].cost,null);
  assert.equal((await get('/api/masters')).body.rates.length,1);
  assert.equal((await get('/api/operations/source')).body.nested.snapshot.total,'1000');
 }
 for(const role of ['Admin','Management','Accounts']){assert.equal((await request(app).get('/api/boqs/fixture').set('X-Fixture-Role',role).set('X-Fixture-Cost-Access','yes')).body.snapshot.total,'364076');assert.equal((await request(app).get('/api/commercial/pricing/fixture').set('X-Fixture-Role',role).set('X-Fixture-Cost-Access','yes')).body.snapshot.rows[0].markup,'30');}
});
test('all registered BESS equipment rate families are confidential',()=>{for(const key of ['HYB-SP-006','HYB-3P-020','BAT-LV-05 KW WO BMS','BAT-HV-05 KW WO BMS','CH-BMS-LV','CH-BMS-HV'])assert.ok(isBessEquipment({key}));assert.equal(canSeeBessCost('Coordinator'),false);assert.equal(canSeeBessCost('Management'),true);});

test('real authenticated API hides BESS masters/policy and costing while retaining Management access',async()=>{
 const {testDatabase}=await import('./database.js');const {createApp}=await import('../server/app.js');const {readConfig}=await import('../server/config.js');const {digest}=await import('../server/auth/crypto.js');const {randomUUID,randomBytes}=await import('node:crypto');const {MastersRepository}=await import('../server/masters/repository.js');const {surveySchema}=await import('../server/boq/schema.js');
 const db=await testDatabase();try{
 const origin='http://localhost:3000',app=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:origin,DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'cost-visibility-test-setup-long-token'}));
 const m=await new MastersRepository(db.pool).list();const brand=(category:string,name:string)=>m.brands.find((b:any)=>b.category===category&&b.name===name)!.id;
 const survey=surveySchema.parse({customerId:3,siteName:'Privacy isolated fixture',siteCode:'PRIVACY',location:'Lahore',panelQty:60,panelWattage:'645',structure:'Elevated',dcMetres:'360',acInverter16:'15',acInverter25:'0',acPanel16:'0',acPanel25:'20',earth25:'20',earth6:'90',earth10:'90',inverter:'2×15 kW',batteryKwh:40,smartMeter:true,genset:true,brands:{solar:brand('Solar Panel','Any of the Above'),inverter:brand('Inverter','Chint Power'),battery:brand('Battery & BMS','Chint Power'),cable:brand('Cable','Newage Cables'),switchgear:brand('Switchgear','CHINT')},preparedBy:'Fixture'});
 for(const role of ['Coordinator','Management','Admin']){
 const user=randomUUID(),token=randomBytes(32).toString('base64url'),csrf=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'unused',$3)",[user,`${user}@example.test`,role]);await db.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),user,csrf]);
 if(role!=='Coordinator')await db.pool.query("INSERT INTO restricted_cost_access(user_id,granted_reason) VALUES($1,'Explicit isolated test capability')",[user]);
 const cookie=`pz_session=${token}`;const master=await request(app).get('/api/masters').set('Cookie',cookie).expect(200);assert.equal(master.body.rates.some((r:any)=>isBessEquipment(r)),role!=='Coordinator');
 const history=await request(app).get('/api/masters/rates/history?key=HYB-3P-012').set('Cookie',cookie);assert.equal(history.status,role==='Coordinator'?403:200);
 if(role==='Coordinator'){const writeRate=await request(app).post('/api/masters/rates').set('Cookie',cookie).set('Origin',origin).set('X-CSRF-Token',csrf).send({id:'HYB-3P-012',version:1,values:{rate:'1',status:'Active',notes:'Fixture'}});assert.equal(writeRate.status,403);}
 const policy=await request(app).get('/api/commercial/standard-policy').set('Cookie',cookie).expect(200);assert.equal(policy.body.markups.bess,role==='Coordinator'?undefined:'30');
 const preview=await request(app).post('/api/boqs/preview').set('Cookie',cookie).set('Origin',origin).set('X-CSRF-Token',csrf).send(survey).expect(200);const s=preview.body.snapshot;
 if(role==='Management'){
 const {price,quote}=await import('../server/commercial/engine.js');const {savedQuotationMarkup,workflowHistory}=await import('../server/boq/workflow-history.js');const {Decimal}=await import('decimal.js');
 const pricingInput={boqRevisionId:randomUUID(),presentation:'No Breakup',taxMode:'Show Sales Tax Separately',markups:{solar:'10',structure:'10',bess:'30',earthing:'10',balance:'25',rest:'25'},preparedBy:'Fixture',remarks:''} as any;
 const p=price(s,'FIXTURE-R0',pricingInput);const q=quote(p,s,{pricingId:randomUUID(),quotedDate:'2026-10-08',validity:'7 Days',proposedBy:'Fixture',discount:'0'});
 assert.equal(savedQuotationMarkup(p,s,q),new Decimal(p.subtotal).minus(p.cost).div(p.cost).mul(100).toFixed(2));
 assert.ok(new Decimal(savedQuotationMarkup(p,s,{...q,input:{...q.input,discount:'11800'}})!).lt(savedQuotationMarkup(p,s,q)!));
 assert.deepEqual(await workflowHistory(db.pool,randomUUID()),[]);
 }
 if(role==='Coordinator'){
 const draft=(await request(app).post('/api/boqs/drafts').set('Cookie',cookie).set('Origin',origin).set('X-CSRF-Token',csrf).send({version:0,inputs:survey}).expect(200)).body;
 const pdf=await request(app).get(`/api/boqs/drafts/${draft.id}/costing.pdf?fingerprint=${preview.body.fingerprint}`).set('Cookie',cookie).expect(200);
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=getDocument({data:new Uint8Array(pdf.body),useSystemFonts:true});const doc=await task.promise;let text='';for(let n=1;n<=doc.numPages;n++)text+=(await(await doc.getPage(n)).getTextContent()).items.map((i:any)=>i.str??'').join(' ');await task.destroy();assert.match(text,/EXCLUDING BESS/);assert.match(text,/Restricted/);for(const l of s.lines.filter((l:any)=>l.phase==='BESS'))assert.equal(l.rate,null);
 }

 if(role==='Coordinator'){assert.equal(s.lines.find((l:any)=>l.phase==='BESS').rate,null);assert.equal(s.summary.some((r:any)=>r.name==='BESS'),false);assert.equal(s.costVisibility,'Excluding BESS');}else{assert.ok(Number(s.lines.find((l:any)=>l.phase==='BESS').rate)>0);assert.ok(s.summary.some((r:any)=>r.name==='BESS'));}
 }
 }finally{await db.close();}
});

 test('redacted revision pricing remains valid without supplying confidential BESS markup',async()=>{
 const {pricingSchema}=await import('../server/commercial/schema.js');
 const original={boqRevisionId:'00000000-0000-4000-8000-000000000001',presentation:'No Breakup',taxMode:'Show Sales Tax Separately',markups:{solar:'10',structure:'10',bess:'30',earthing:'10',balance:'25',rest:'25'},preparedBy:'Atif Hameed',remarks:'Revised technical BOQ'};
 const redacted=restrictedCostView(original,true);assert.equal(redacted.markups.bess,undefined);const parsed=pricingSchema.parse(redacted);assert.equal(parsed.markups.bess,'0');assert.equal(parsed.markups.balance,'25');assert.equal(parsed.remarks,original.remarks);
 });

test('restricted financial projection preserves database timestamps including nested Accounts handoffs',()=>{
 const date=new Date('2026-10-08T18:20:00.000Z');const result=restrictedCostView({created_at:date,accounts_handoff:{created_at:date,sent_by:'Atif'}});
 assert.equal(result.created_at,date.toISOString());assert.equal(result.accounts_handoff.created_at,date.toISOString());assert.ok(Number.isFinite(new Date(result.accounts_handoff.created_at).getTime()));assert.equal(date.toISOString(),'2026-10-08T18:20:00.000Z');
});
