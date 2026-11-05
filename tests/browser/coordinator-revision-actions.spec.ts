import {test,expect} from '@playwright/test';
import {actors,login,seedQuote} from './release-fixtures.js';

for(const stage of ['ready','followup'] as const)test(`Coordinator starts a ${stage==='ready'?'commercial':'technical'} revision from ${stage==='ready'?'Ready to Send':'Customer Follow-up'}`,async({page})=>{
 await actors(page.request);const headers=await login(page.request,'coordinator-release@example.test');
 const {quote,boq,inputs}=await seedQuote(page.request,headers,'REV-'+stage,true);
 const bucket=stage==='ready'?'Approved Documents—Awaiting Dispatch':'Customer Decision & Order Tracking';
 const record={id:'workflow-'+stage,version:1,customer:'Bank Alfalah',customerCode:'BAFL',site:inputs.siteName,siteCode:inputs.siteCode,route:'quick-quote',routeLabel:'Quick BOQ → quotation',stage:stage==='ready'?'approved_dispatch':'customer_tracking',coordinationBucket:bucket,quotation:{id:quote.id,number:quote.number},data:{},started_at:new Date().toISOString()};
 await page.route('**/api/project-workflow?*',r=>r.fulfill({json:{records:[record],legacyTasks:[]}}));
 await page.route('**/api/project-workflow/'+record.id,r=>r.fulfill({json:{record,files:[]}}));
 await page.goto('/dashboard#workspace=coordination');
 await page.getByRole('button',{name:stage==='ready'?/^Ready to Send/:/^Customer Follow-up/}).click();
 const row=page.getByRole('row').filter({hasText:inputs.siteName});
 await expect(row.getByRole('button',{name:'Create Revision',exact:true})).toBeVisible();
 // Review and revision remain parallel actions; descriptions cannot stretch or recenter them.
 const boxes=await Promise.all(['Review','Create Revision'].map(name=>row.getByRole('button',{name,exact:true}).boundingBox()));
 expect(Math.abs(boxes[0]!.y-boxes[1]!.y)).toBeLessThan(2);
 if(stage==='followup'){
  await row.getByRole('button',{name:'Review',exact:true}).click();
  await expect(page.getByRole('button',{name:'Create Revision',exact:true})).toBeVisible();
 }
 await page.getByRole('button',{name:'Create Revision',exact:true}).click();
 await page.getByLabel('Revision reason',{exact:true}).fill('Customer requested an isolated '+stage+' revision');
 await page.getByLabel('Revision source',{exact:true}).selectOption('Customer');
 await page.getByLabel('Requires costing change',{exact:true}).selectOption(stage==='ready'?'no':'yes');
 await expect(page.getByRole('button',{name:'Continue Revision',exact:true})).toBeEnabled();
 await page.screenshot({path:'test-results/coordinator-'+stage+'-revision.png',fullPage:true});
 page.on('dialog',d=>d.accept());
 const sent=page.waitForRequest(r=>r.url().endsWith('/api/commercial/revision-requests')&&r.method()==='POST');
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/commercial/revision-requests')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Continue Revision',exact:true}).click();
 const body=(await sent).postDataJSON();expect(body.sourceQuotationId).toBe(quote.id);expect(body.costingChange).toBe(stage==='followup');expect(body.reason).toContain(stage);expect(body.origin).toBe('Customer');
 const response=await saved;expect(response.ok(),await response.text()).toBe(true);const revision=await response.json();
 expect(Boolean(revision.draft_id)).toBe(stage==='followup');
 await expect(page).toHaveURL(new RegExp('workspace='+(stage==='ready'?'pricing':'boqs')));
 const original=await(await page.request.get('/api/commercial/quotations/'+quote.id)).json();
 expect(original.snapshot).toEqual(quote.snapshot);expect(original.boq_revision_id).toBe(boq.id);
 expect(original.workflow_status).toBe('Submitted');
});
