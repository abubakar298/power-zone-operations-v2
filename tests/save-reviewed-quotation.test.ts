import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {saveReviewedQuotation} from '../web/save-reviewed-quotation.js';
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
 assert.equal(saved.quotation.snapshot.footer.at(-1).amount,source.snapshot.footer.at(-1).amount);
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
