import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import request from 'supertest';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import {hashPassword} from '../server/auth/crypto.js';
import {testDatabase} from './database.js';
import {MastersRepository} from '../server/masters/repository.js';
import {calculate} from '../server/boq/engine.js';
import {surveySchema} from '../server/boq/schema.js';
import {price,quote} from '../server/commercial/engine.js';
import {pricingSchema,quotationSchema} from '../server/commercial/schema.js';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {buildQuotationPdf} from '../server/commercial/report.js';
import {quotationDisplayRows} from '../server/commercial/quotation-rows.js';

test('Atif can version only item commercial wording; role, concurrency, technical values and old versions are protected',async()=>{
 const db=await testDatabase();try{
  const repo=new MastersRepository(db.pool),coordinator=randomUUID(),design=randomUUID();
  for(const[id,role] of [[coordinator,'Coordinator'],[design,'Design']])await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated',$3)",[id,id+'@example.test',role]);
  const password='isolated-commercial-wording-test-only';await db.pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[await hashPassword(password),coordinator]);
  const origin='http://localhost:3000',app=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:origin,DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'isolated-commercial-wording-setup-only'}));
  const login=await request(app).post('/api/auth/login').set('Origin',origin).send({email:coordinator+'@example.test',password}).expect(200),cookie=login.headers['set-cookie'][0].split(';')[0],csrf=login.body.csrfToken;
  await request(app).post('/api/masters/catalogue-commercial-description').set('Origin',origin).set('Cookie',cookie).set('X-CSRF-Token',csrf).send({itemId:'CH-BAT-HV-05 KW',version:1,commercialDescription:'Rejected',technicalDescription:'Do not change technical data'}).expect(400);
  await request(app).post('/api/masters/catalogue-commercial-description').set('Origin',origin).set('Cookie',cookie).send({itemId:'CH-BAT-HV-05 KW',version:1,commercialDescription:'Rejected'}).expect(403);
  const item=(await db.pool.query("SELECT * FROM inventory_catalogue_final_current WHERE item_id='CH-BAT-HV-05 KW'")).rows[0],before=JSON.stringify((await db.pool.query('SELECT * FROM inventory_catalogue_versions WHERE item_id=$1 AND version=$2',[item.item_id,item.version])).rows[0]),rates=JSON.stringify((await db.pool.query('SELECT * FROM rate_versions ORDER BY key,version')).rows);
  await assert.rejects(repo.saveCommercialDescription(design,item.item_id,item.version,'Rejected'),/access required/);
  const saved=await repo.saveCommercialDescription(coordinator,item.item_id,item.version,'Customer battery wording');
  assert.equal(saved.version,item.version+1);assert.equal(saved.payload.commercialDescription,'Customer battery wording');assert.deepEqual({...saved.payload,commercialDescription:item.payload.commercialDescription},item.payload);assert.equal(saved.rate_key,item.rate_key);
  assert.equal(JSON.stringify((await db.pool.query('SELECT * FROM inventory_catalogue_versions WHERE item_id=$1 AND version=$2',[item.item_id,item.version])).rows[0]),before);
  await assert.rejects(repo.saveCommercialDescription(coordinator,item.item_id,item.version,'Stale'),/changed/);
  await assert.rejects(repo.saveCommercialDescription(coordinator,item.item_id,saved.version,'  '),/description/);
  assert.equal(JSON.stringify((await db.pool.query('SELECT * FROM rate_versions ORDER BY key,version')).rows),rates);
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM audit_log WHERE user_id=$1 AND action LIKE 'master.commercial-description.changed:%'",[coordinator])).rows[0].n,1);
  const m=await repo.list(),brand=(category:string,name:string)=>m.brands.find((b:any)=>b.category===category&&b.name===name)!.id;
  const survey=surveySchema.parse({customerId:3,siteName:'Description test',siteCode:'0001',location:'Lahore',panelQty:32,panelWattage:'620',structure:'Elevated',dcMetres:'100',earth25:'20',earth6:'30',earth10:'40',inverter:'20 kW',batteryKwh:30,smartMeter:false,genset:false,brands:{solar:brand('Solar Panel','Any of the Above'),inverter:brand('Inverter','Chint Power'),battery:brand('Battery & BMS','Chint Power'),cable:brand('Cable','Newage Cables'),switchgear:brand('Switchgear','CHINT')},preparedBy:'Atif'});
  const boq=calculate(survey,m),original=JSON.stringify(boq),commercial={...boq,lines:boq.lines.map(l=>({...l,commercialDescription:m.catalogue.find((i:any)=>i.item_id===l.itemId)?.payload.commercialDescription}))};
  for(const presentation of ['No Breakup','Basic Breakup','Full Breakup'])for(const taxMode of ['Tax Included','Show Sales Tax Separately']){
   const pi=pricingSchema.parse({boqRevisionId:randomUUID(),presentation,taxMode,markups:{solar:'20',structure:'20',bess:'15',earthing:'20',balance:'20',rest:'20'},discount:'0',preparedBy:'Atif'}),p=price(boq,'TEST',pi),qi=quotationSchema.parse({pricingId:randomUUID(),quotedDate:'2026-10-15',validity:'7 Days',proposedBy:'Atif'}),base=quote(p,boq,qi),updated=quote(p,commercial,qi);
   assert(updated.lines.some(l=>l.description==='Customer battery wording'));assert.deepEqual(updated.footer,base.footer);assert.deepEqual(updated.lines.map(l=>[l.qty,l.unit,l.amount]),base.lines.map(l=>[l.qty,l.unit,l.amount]));
   const descriptions=base.lines.slice(0,base.scopeCount).map(l=>l.description),copied=quote(p,commercial,{...qi,descriptions});assert.deepEqual(copied.lines.map(l=>l.description),base.lines.map(l=>l.description));
   assert(quotationDisplayRows(updated.lines).some(l=>l.description==='Customer battery wording'));
  }
  assert.equal(JSON.stringify(boq),original);
  const active=(await db.pool.query('SELECT version,policy FROM standard_commercial_policy_versions ORDER BY version DESC LIMIT 1')).rows[0];
  for(const family of ['bess-only','direct-product']){
   const source=calculate(surveySchema.parse({...survey,family,panelQty:0,panelWattage:'0',...(family==='direct-product'?{inverter:'Products',batteryKwh:0,directProducts:[{kind:'item',key:'BAT-HV-05 KW WO BMS',qty:'2'}]}:{})}),m);
   const current={...source,lines:source.lines.map(l=>({...l,commercialDescription:m.catalogue.find((i:any)=>i.item_id===l.itemId)?.payload.commercialDescription}))};
   for(const presentation of (family==='direct-product'?['No Breakup','Full Breakup']:['No Breakup','Basic Breakup','Full Breakup'])){
    const pi=pricingSchema.parse({boqRevisionId:randomUUID(),presentation,taxMode:'Show Sales Tax Separately',markups:{solar:'20',structure:'20',bess:'15',earthing:'20',balance:'20',rest:'20'},discount:'0',preparedBy:'Atif'}),p=price(source,'TEST',pi,{...active.policy,version:active.version}),qi=quotationSchema.parse({pricingId:randomUUID(),quotedDate:'2026-10-15',validity:'7 Days',proposedBy:'Atif'}),base=quote(p,source,qi),updated=quote(p,current,qi);
    assert(updated.lines.some(l=>l.description==='Customer battery wording'));assert.deepEqual(updated.footer,base.footer);assert.deepEqual(updated.lines.map(l=>[l.qty,l.unit,l.amount]),base.lines.map(l=>[l.qty,l.unit,l.amount]));
    const task=getDocument({data:new Uint8Array(buildQuotationPdf(updated,'TEST-R1')),useSystemFonts:true});try{const pdf=await task.promise;let text='';for(let i=1;i<=pdf.numPages;i++)text+=(await(await pdf.getPage(i)).getTextContent()).items.map((v:any)=>v.str??'').join(' ');assert.match(text,/Customer battery wording/);}finally{await task.destroy();}
   }
  }
 }finally{await db.close();}
});
