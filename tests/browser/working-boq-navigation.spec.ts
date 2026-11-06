import {test,expect} from '@playwright/test';
import {actors,login,survey,seedQuote} from './release-fixtures.js';
import {openBoqSection} from './navigation.js';
for(const role of ['Coordinator','Management','Admin'])test(`${role} returns to the same working BOQ and creates the quotation only explicitly`,async({page})=>{
 page.on('dialog',d=>d.accept());await actors(page.request);const headers=await login(page.request,role==='Admin'?'admin@example.test':role.toLowerCase()+'-release@example.test');
 const post=async(path:string,data:any)=>{const r=await page.request.post('/api'+path,{headers,data});expect(r.ok(),await r.text()).toBe(true);return r.json();};
 const inputs=await survey(page.request,'WORK-'+role),draft=await post('/boqs/drafts',{version:0,inputs}),bp=await post('/boqs/preview',inputs),boq=await post('/boqs/prepare',{draftId:draft.id,version:draft.version,fingerprint:bp.fingerprint});
 await page.goto('/dashboard#workspace=pricing');await page.getByLabel('BOQ revision',{exact:true}).selectOption(boq.id);
 await expect(page.getByRole('button',{name:'Back to BOQ Settings',exact:true})).toBeVisible();
 for(const qty of ['22','24']){
  await page.getByRole('button',{name:'Back to BOQ Settings',exact:true}).click();await expect(page.getByRole('heading',{name:'Edit BOQ',exact:true})).toBeVisible();
  await openBoqSection(page,2);await page.getByLabel('Panel quantity',{exact:true}).fill(qty);
  const response=page.waitForResponse(r=>r.url().endsWith('/api/boqs/prepare')&&r.request().method()==='POST');await page.getByRole('button',{name:'Save & Continue to Quotation Settings',exact:true}).click();const result=await response;expect(result.ok(),await result.text()).toBe(true);const saved=await result.json();expect(saved.id).toBe(boq.id);expect(saved.number).toBe(boq.number);
  await expect(page.getByLabel('BOQ revision',{exact:true})).toHaveValue(boq.id);await page.reload();await expect(page.getByLabel('BOQ revision',{exact:true})).toHaveValue(boq.id);
 }
 const drafts=(await(await page.request.get('/api/boqs/drafts')).json()).drafts;expect(drafts.filter((d:any)=>d.id===draft.id)).toHaveLength(1);
 await expect.poll(async()=>(await(await page.request.get('/api/commercial/quotations')).json()).quotations.filter((q:any)=>q.boq_revision_id===boq.id).length).toBe(0);
 await page.getByRole('button',{name:'Preview Quotation',exact:true}).click();await expect(page.locator('.quotation-pdf-pages canvas').first()).toBeVisible();
 await expect(page.getByRole('main').getByRole('button',{name:'Create Quotation',exact:true})).toBeVisible();
 const savedQuote=page.waitForResponse(r=>r.url().endsWith('/api/commercial/quotations')&&r.request().method()==='POST');await page.getByRole('main').getByRole('button',{name:'Create Quotation',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:/Save quotation|Confirm and send/}).click();const response=await savedQuote;expect(response.ok(),await response.text()).toBe(true);
 const locked=await page.request.post('/api/boqs/'+boq.id+'/working-preparation',{headers,data:{}});expect(locked.status()).toBe(409);
 await page.screenshot({path:'test-results/working-boq-'+role+'.png',fullPage:true});
});
test('commercial revision switches to technical BOQ editing and exposes direct Send to Management',async({page})=>{
 page.on('dialog',d=>d.accept());await actors(page.request);const headers=await login(page.request,'coordinator-release@example.test'),source=await seedQuote(page.request,headers,'TECH-SWITCH',true);
 const post=async(path:string,data:any)=>{const r=await page.request.post('/api'+path,{headers,data});expect(r.ok(),await r.text()).toBe(true);return r.json();};
 const r=await post('/commercial/revision-requests',{sourceQuotationId:source.quote.id,origin:'Customer',costingChange:false,reason:'Change equipment quantities',requestedBy:'Customer',requestKey:crypto.randomUUID()});
 // Open the normal persisted task from the shared Revisions bucket.
 await page.goto('/dashboard#workspace=coordination');await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/^Revisions/}).click();await page.getByRole('row').filter({hasText:source.quote.number}).getByRole('button',{name:'Continue Revision',exact:true}).click();
 await expect(page.getByRole('button',{name:'Back to BOQ Settings',exact:true})).toBeVisible();await page.getByRole('button',{name:'Back to BOQ Settings',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Switch to technical revision',exact:true}).click();
 await expect(page.getByLabel('Panel quantity',{exact:true})).toHaveValue(String(source.inputs.panelQty));
 const saved=page.waitForResponse(x=>x.url().endsWith('/api/boqs/prepare')&&x.request().method()==='POST');await page.getByRole('button',{name:'Save & Continue to Quotation Settings',exact:true}).click();expect((await saved).ok()).toBe(true);
 await page.getByRole('button',{name:'Preview Quotation',exact:true}).click();await expect(page.getByRole('button',{name:'Save Revision',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Send to Management',exact:true})).toBeVisible();
 const acknowledge=page.getByRole('checkbox',{name:'I have reviewed and acknowledge the change in payable.',exact:true});if(await acknowledge.count())await acknowledge.check();
 await page.getByRole('button',{name:'Send to Management',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Save and send',exact:true}).click();
 await expect.poll(async()=>{const requests=(await(await page.request.get('/api/commercial/revision-requests')).json()).requests;return requests.find((x:any)=>x.id===r.id)?.completed_quotation_id;}).toBeTruthy();
 const requests=(await(await page.request.get('/api/commercial/revision-requests')).json()).requests,next=requests.find((x:any)=>x.id===r.id),revised=await(await page.request.get('/api/commercial/quotations/'+next.completed_quotation_id)).json();expect(revised.workflow_status).toBe('Submitted');expect((await(await page.request.get('/api/commercial/quotations/'+source.quote.id)).json()).snapshot).toEqual(source.quote.snapshot);
});
