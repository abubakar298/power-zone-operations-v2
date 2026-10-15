import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {prepareReviewedQuotationInput,saveReviewedQuotation} from '../web/save-reviewed-quotation.js';
import {testDatabase} from './database.js';
import {createDashboardSamples} from '../server/coordinator/samples.js';
import {CommercialRepository} from '../server/commercial/repository.js';
import {CoordinatorRepository} from '../server/coordinator/repository.js';
import {pricingSchema,quotationSchema} from '../server/commercial/schema.js';
import {buildQuotationPdf} from '../server/commercial/report.js';
import {NotificationsRepository} from '../server/notifications/repository.js';
async function textOf(bytes:Uint8Array){const t=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});try{const pdf=await t.promise;let text='';for(let i=1;i<=pdf.numPages;i++)text+=(await(await pdf.getPage(i)).getTextContent()).items.map((x:any)=>x.str??'').join(' ');return text;}finally{await t.destroy();}}

test('Save Revision persists current edited rows and terms, reviews saved PDF, and submits that same version to Management and email',async()=>{
 const db=await testDatabase();try{
 const c=db.pool,owner=randomUUID(),manager=randomUUID();
 for(const [id,role]of [[owner,'Coordinator'],[manager,'Management']])await c.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated',$4)",[id,id+'@example.test',role,role]);
 const samples=await createDashboardSamples(c,owner,manager),record=samples.find((r:any)=>r.stage===4)!;
 const repo=new CommercialRepository(c),coord=new CoordinatorRepository(c),source=await repo.quotationGet(record.quotationId),original=JSON.stringify(source.snapshot);
 const revision=await repo.revisionStart(owner,source.id,'Internal management',false,'Description correction only','Atif',randomUUID());
 const pricing=await repo.pricingGet(owner,source.pricing_id);
 const pricingInput=pricingSchema.parse({...pricing.snapshot.input,revisionRequestId:revision.id});
 const currentPrice=await repo.pricingPreview(owner,pricingInput);
 const input=quotationSchema.parse({pricingId:randomUUID(),previewPricing:pricingInput,revisionRequestId:revision.id,quotedDate:'2026-10-15',validity:'21 Days',proposedBy:'Atif revised',discount:source.snapshot.input.discount??'0',descriptions:source.snapshot.lines.slice(0,source.snapshot.scopeCount).map((l:any,i:number)=>i===0?'REVISED CUSTOMER SPECIFICATION CURRENT FORM':l.description)});
 const calls:string[]=[];
 const request=async(path:string,body?:any)=>{calls.push(path);if(path==='/commercial/quotations/preview')return repo.quotationPreview(owner,quotationSchema.parse(body));if(path==='/commercial/pricing/preview')return repo.pricingPreview(owner,pricingSchema.parse(body));if(path==='/commercial/pricing')return repo.pricingSave(owner,pricingSchema.parse(Object.fromEntries(Object.entries(body).filter(([k])=>!['fingerprint','requestKey'].includes(k)))),body.fingerprint,body.requestKey);if(path==='/commercial/quotations')return repo.quotationSave(owner,quotationSchema.parse(Object.fromEntries(Object.entries(body).filter(([k])=>!['fingerprint','requestKey'].includes(k)))),body.fingerprint,body.requestKey);if(path.startsWith('/commercial/quotations/'))return repo.quotationGet(path.split('/').at(-1)!);throw Error('Unexpected request '+path);};
 const saved=await saveReviewedQuotation({input,requestKey:randomUUID(),pricingFingerprint:currentPrice.fingerprint,acknowledgePriceChange:false},request);
 assert.notEqual(saved.quotation.id,source.id);assert.equal(saved.quotation.workflow_status,null);assert.equal(saved.quotation.snapshot.lines[0].description,input.descriptions![0]);
 assert.equal(saved.quotation.snapshot.input.quotedDate,input.quotedDate);assert.equal(saved.quotation.snapshot.input.validity,'21 Days');assert.equal(saved.quotation.snapshot.input.proposedBy,'Atif revised');
 assert.equal(saved.quotation.snapshot.footer.at(-1)!.amount,source.snapshot.footer.at(-1)!.amount);
 assert.equal(JSON.stringify((await repo.quotationGet(source.id)).snapshot),original);
 assert.ok(!calls.includes('/coordinator/events'));assert.equal(calls.at(-1),'/commercial/quotations/'+saved.quotation.id);
 const pdfText=await textOf(buildQuotationPdf(saved.quotation.snapshot,saved.quotation.number));assert.match(pdfText,/REVISED CUSTOMER SPECIFICATION CURRENT FORM/);assert.match(pdfText,/21 Days/);assert.match(pdfText,/Atif revised/);
 await coord.event(owner,saved.quotation.id,'Submitted','Submitted saved revision');
 const management=await repo.quotationGet(saved.quotation.id);assert.equal(management.workflow_status,'Submitted');assert.equal(management.snapshot.lines[0].description,input.descriptions![0]);
 await c.query("UPDATE notification_settings SET activated_at=now()-interval '2000 hours',email_enabled=true,reminders_enabled=false");
 const notifications=new NotificationsRepository(c);await notifications.sync();
 const n=(await c.query("SELECT n.id FROM notifications n JOIN notification_email_queue e ON e.id=n.id WHERE n.user_id=$1 AND n.entity_key=$2 AND n.kind='Submitted'",[manager,'quote:'+saved.quotation.id])).rows[0];assert.ok(n);
 await c.query("UPDATE notification_email_queue SET next_attempt_at=now()+interval '1 day' WHERE id<>$1",[n.id]);
 let message:any;await notifications.deliverOne({configured:true,send:async(m:any)=>{message=m;return 'isolated-mail';}},'https://example.test');
 assert.match(await textOf(Buffer.from(message.attachments[0].content,'base64')),/REVISED CUSTOMER SPECIFICATION CURRENT FORM/);
 assert.equal(JSON.stringify((await repo.quotationGet(source.id)).snapshot),original);
 }finally{await db.close();}
});

test('save refuses unacknowledged payable changes and never writes a quotation from a stale preview',async()=>{
 const calls:string[]=[];await assert.rejects(saveReviewedQuotation({input:{pricingId:randomUUID(),quotedDate:'2026-10-15',validity:'7 Days',proposedBy:'Atif'},requestKey:randomUUID(),acknowledgePriceChange:false},async(path)=>{calls.push(path);return {snapshot:{revision:{comparison:{previousPayable:'100',proposedPayable:'90'}}},fingerprint:'fresh'};}),/acknowledge/);assert.deepEqual(calls,['/commercial/quotations/preview']);
});


test('repriced revisions discard inherited discount: 1,960,000 to 1,990,000 survives saved PDF and Management across entry routes',async()=>{
 const db=await testDatabase();try{
 const {BoqRepository}=await import('../server/boq/repository.js');const {surveySchema}=await import('../server/boq/schema.js');
 const owner=randomUUID(),manager=randomUUID();for(const[id,role]of [[owner,'Coordinator'],[manager,'Management']])await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated',$4)",[id,id+'@example.test',role,role]);
 const repo=new CommercialRepository(db.pool),boqs=new BoqRepository(db.pool),coord=new CoordinatorRepository(db.pool);
 const request=async(path:string,body?:any)=>{if(path==='/commercial/quotations/preview')return repo.quotationPreview(owner,quotationSchema.parse(body));if(path==='/commercial/pricing/preview')return repo.pricingPreview(owner,pricingSchema.parse(body));if(path==='/commercial/pricing')return repo.pricingSave(owner,pricingSchema.parse(body),body.fingerprint,body.requestKey);if(path==='/commercial/quotations')return repo.quotationSave(owner,quotationSchema.parse(body),body.fingerprint,body.requestKey);if(path.startsWith('/commercial/quotations/'))return repo.quotationGet(path.split('/').at(-1)!);throw Error(path);};
 const survey=surveySchema.parse({family:'direct-product',customerId:3,siteName:'Isolated Elahi regression',siteCode:'REV-SAVE',location:'',panelQty:0,panelWattage:'0',structure:'L1',dcMetres:'0',earth25:'0',earth6:'0',earth10:'0',inverter:'Products',batteryKwh:0,brands:{},smartMeter:false,genset:false,preparedBy:'Atif',directProducts:[{kind:'item',key:'HYB-3P-020',qty:'1'},{kind:'item',key:'BAT-HV-05 KW WO BMS',qty:'4'},{kind:'item',key:'CH-BMS-HV',qty:'1'}]});
 const draft=await boqs.draft(owner,undefined,0,survey),bp=await boqs.preview(survey),boq=await boqs.save(owner,draft.id,draft.version,bp.fingerprint);
 const base=pricingSchema.parse({boqRevisionId:boq.id,presentation:'No Breakup',taxMode:'Tax Included',saleType:'Cash Deal',cashGstTreatment:'No GST added',discountMode:'Custom',roundedTotal:'1960000',preparedBy:'Atif'});
 const pp=await repo.pricingPreview(owner,base),ps=await repo.pricingSave(owner,base,pp.fingerprint,randomUUID());
 const qi=quotationSchema.parse({pricingId:ps.id,discount:pp.snapshot.discount,quotedDate:'2026-10-15',validity:'7 Days',proposedBy:'Atif'}),qp=await repo.quotationPreview(owner,qi),source=await repo.quotationSave(owner,qi,qp.fingerprint,randomUUID());
 assert.equal(source.snapshot.footer.at(-1)!.amount,'1960000.00');const original=JSON.stringify(source.snapshot);
 for(const route of ['management-return','self-commercial','resumed-technical','saved-pricing']){
  if(route==='management-return')await coord.event(owner,source.id,'Submitted','Isolated test');
  const revision=await repo.revisionStart(route==='management-return'?manager:owner,source.id,'Internal management',route==='resumed-technical','Update quote','Atif',randomUUID(),route==='management-return'?'return':'edit');
  let boqId=boq.id;if(route==='resumed-technical'){
   const d=(await db.pool.query('SELECT * FROM survey_drafts WHERE id=$1',[revision.draft_id])).rows[0],p=await boqs.preview(d.inputs);boqId=(await boqs.save(owner,d.id,d.version,p.fingerprint)).id;
   assert.equal((await repo.revisionContext(owner,boqId)).id,revision.id);
  }
  const pricing=pricingSchema.parse({...base,boqRevisionId:boqId,revisionRequestId:revision.id,roundedTotal:'1990000'});
  const fresh=await repo.pricingPreview(owner,pricing);
  const inherited=quotationSchema.parse({...qi,pricingId:randomUUID(),previewPricing:pricing,revisionRequestId:revision.id});
  // Reproduce the old bug: explicitly inherited source discount overrides revised rounded pricing.
  assert.equal((await repo.quotationPreview(owner,inherited)).snapshot.footer.at(-1)!.amount,'1960000.00');
  const prepared=await prepareReviewedQuotationInput(inherited,request);
  assert.equal(prepared.discount,fresh.snapshot.discount);assert.notEqual(prepared.discount,qi.discount);
  assert.equal((await repo.quotationPreview(owner,prepared)).snapshot.footer.at(-1)!.amount,'1990000.00');
  const saveInput=route==='saved-pricing'?{...prepared,previewPricing:undefined,pricingId:(await repo.pricingSave(owner,pricing,fresh.fingerprint,randomUUID())).id,discount:fresh.snapshot.discount}:prepared;
  const saved=await saveReviewedQuotation({input:saveInput,requestKey:randomUUID(),pricingFingerprint:fresh.fingerprint,acknowledgePriceChange:true},request);
  assert.equal(saved.quotation.snapshot.footer.at(-1)!.amount,'1990000.00');
  assert.match(await textOf(buildQuotationPdf(saved.quotation.snapshot,saved.quotation.number)),/1,990,000/);
  await coord.event(owner,saved.quotation.id,'Submitted','Isolated saved revision');assert.equal((await repo.quotationGet(saved.quotation.id)).snapshot.footer.at(-1)!.amount,'1990000.00');
  assert.equal(JSON.stringify((await repo.quotationGet(source.id)).snapshot),original);
 }
 // Copy-only wording edits retain the source quote's explicit discount and perform no repricing.
 const copy=await prepareReviewedQuotationInput(qi,async()=>{throw Error('Copy-only must not reprice');});assert.equal(copy.discount,qi.discount);
 }finally{await db.close();}
});

test('revised settings stay authoritative for all six solar quotation formats and both cash GST treatments',async()=>{
 const {Decimal}=await import('decimal.js');const db=await testDatabase();try{
 const owner=randomUUID(),manager=randomUUID();for(const[id,role]of [[owner,'Coordinator'],[manager,'Management']])await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated',$4)",[id,id+'@example.test',role,role]);
 const repo=new CommercialRepository(db.pool),samples=await createDashboardSamples(db.pool,owner,manager),source=await repo.quotationGet(samples.find((r:any)=>r.stage===4)!.quotationId),pricing=await repo.pricingGet(owner,source.pricing_id);
 for(const presentation of ['No Breakup','Basic Breakup','Full Breakup'])for(const taxMode of ['Tax Included','Show Sales Tax Separately'])for(const cash of [undefined,'No GST added','Included in selling price']){
 const r=await repo.revisionStart(owner,source.id,'Internal management',false,'Verify revised settings','Atif',randomUUID());
 const base=pricingSchema.parse({...pricing.snapshot.input,revisionRequestId:r.id,presentation,taxMode,saleType:cash?'Cash Deal':'Tax Deal',cashGstTreatment:cash,discountMode:'Custom',discountPercent:'0',roundedTotal:undefined});
 const gross=await repo.pricingPreview(owner,base),target=new Decimal(gross.snapshot.total).mul('0.97').toFixed(2),current=pricingSchema.parse({...base,roundedTotal:target});
 const request=async(path:string,body?:any)=>{if(path==='/commercial/pricing/preview')return repo.pricingPreview(owner,pricingSchema.parse(body));if(path==='/commercial/quotations/preview')return repo.quotationPreview(owner,quotationSchema.parse(body));if(path==='/commercial/pricing')return repo.pricingSave(owner,pricingSchema.parse(body),body.fingerprint,body.requestKey);if(path==='/commercial/quotations')return repo.quotationSave(owner,quotationSchema.parse(body),body.fingerprint,body.requestKey);return repo.quotationGet(path.split('/').at(-1)!);};
 const input=await prepareReviewedQuotationInput(quotationSchema.parse({pricingId:randomUUID(),previewPricing:current,revisionRequestId:r.id,discount:source.snapshot.input.discount,quotedDate:'2026-10-15',validity:'7 Days',proposedBy:'Atif'}),request),pp=await repo.pricingPreview(owner,current);
 const saved=await saveReviewedQuotation({input,requestKey:randomUUID(),pricingFingerprint:pp.fingerprint,acknowledgePriceChange:true},request);
 assert.equal(saved.quotation.snapshot.footer.at(-1)!.amount,target,`${presentation}/${taxMode}/${cash??'Tax Deal'}`);
 }
 }finally{await db.close();}
});
