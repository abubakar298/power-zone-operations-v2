import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
const ipoId='11111111-1111-4111-8111-111111111111',recordId='22222222-2222-4222-8222-222222222222';
const status=(over:any={})=>({original:{id:ipoId,number:'CHP-351'},current:{id:ipoId,number:'CHP-351',amount:'3860000.00'},revisedIpos:[],canStart:true,quotationSource:true,blockers:{commercial:[],technical:['Inventory has issued a DO for this site']},revisions:[],...over});

test('Coordinator opens an IPO, chooses a route and reason, and starts an IPO revision',async({page})=>{
 await actors(page.request);await login(page.request,'coordinator-release@example.test');
 const record={id:recordId,version:3,customer:'Elahi Energy',customerCode:'ELEN',site:'Faisalabad',siteCode:'FSD',route:'quick-quote',routeLabel:'Quick BOQ → quotation',stage:'issued',coordinationBucket:'IPOs Shared',nextAction:'Preview',data:{ipoShared:true,ipoId,ipoNumber:'CHP-351',sharedPoReference:'WA-Faisalabad-2026-10-16',sharedPoDate:'2026-10-16'},started_at:new Date().toISOString()};
 await page.route('**/api/project-workflow?*',r=>r.fulfill({json:{records:[record],legacyTasks:[]}}));
 await page.route('**/api/project-workflow/'+recordId,r=>r.fulfill({json:{record,files:[]}}));
 await page.route(`**/api/orders/${ipoId}/ipo.pdf`,r=>r.fulfill({status:404,body:''}));
 let started:any;
 await page.route(`**/api/project-workflow/${recordId}/ipo-revisions`,r=>{if(r.request().method()==='POST'){started=r.request().postDataJSON();return r.fulfill({json:{id:'33333333-3333-4333-8333-333333333333',route:'commercial',draftId:null,boqRevisionId:'44444444-4444-4444-8444-444444444444',quotationRevisionRequestId:'55555555-5555-4555-8555-555555555555'}});}return r.fulfill({json:status()});});
 await page.goto('/dashboard#workspace=coordination');
 await page.getByRole('button',{name:/^IPOs Shared/}).click();
 await page.getByRole('row').filter({hasText:'Faisalabad'}).getByRole('button',{name:'Preview',exact:true}).click();
 const panel=page.getByRole('region',{name:'IPO revisions'});
 await expect(panel).toContainText('A saved IPO is never changed');
 await panel.getByRole('button',{name:'Revise IPO',exact:true}).click();
 const start=panel.getByRole('button',{name:'Start IPO revision',exact:true});await expect(start).toBeDisabled();
 await panel.getByLabel('Revision route (required)').selectOption('technical');
 await expect(panel.getByRole('alert')).toContainText('Inventory has issued a DO');await expect(start).toBeDisabled();
 await panel.getByLabel('Revision route (required)').selectOption('commercial');
 await panel.getByLabel(/Why is this IPO revised/).fill('Customer wants prices shown with GST included.');
 await page.screenshot({path:'test-results/ipo-revision-start.png',fullPage:true});
 await expect(start).toBeEnabled();await start.click();
 await expect.poll(()=>started).toMatchObject({route:'commercial',reason:'Customer wants prices shown with GST included.'});
});

test('Management reviews an IPO revision with its reason and returns it with a note',async({page})=>{
 await actors(page.request);await login(page.request,'management-release@example.test');
 const pending={id:'66666666-6666-4666-8666-666666666666',number:'CHP-351-R1',route:'commercial',reason:'Customer wants prices shown with GST included.',recordId,site:'Faisalabad',customer:'ELEN',requestedBy:'Atif',createdAt:'2026-11-13T10:00:00Z',quotationNumber:'QT-REV-1',
  before:{id:ipoId,number:'CHP-351',amount:'3860000.00',footer:[{label:'Net Total',amount:'3860000.00'}]},after:{amount:'4100000.00',footer:[{label:'Net Total',amount:'4100000.00'}]}};
 let rows=[pending],decided:any;
 await page.route('**/api/project-workflow/ipo-revisions/pending',r=>r.fulfill({json:{revisions:rows}}));
 await page.route(`**/api/project-workflow/ipo-revisions/proposals/${pending.id}/decision`,r=>{decided=r.request().postDataJSON();rows=[];return r.fulfill({json:{decision:'Returned',revisedIpoId:null}});});
 await page.route('**/ipo.pdf',r=>r.fulfill({status:404,body:''}));
 await page.goto('/dashboard');
 const card=page.getByRole('button',{name:/^IPO revisions/});await expect(card).toContainText('1');await card.click();
 const queue=page.getByRole('region',{name:'IPO revisions awaiting approval'});
 await expect(queue).toContainText('Reason: Customer wants prices shown with GST included.');await expect(queue).toContainText('revises CHP-351');
 await queue.getByRole('button',{name:'Review',exact:true}).click();
 await expect(queue.getByRole('cell',{name:'Net Total'})).toBeVisible();
 const back=queue.getByRole('button',{name:'Return to Coordination',exact:true});await expect(back).toBeDisabled();
 await queue.getByLabel('Note (required to return)').fill('Keep the agreed GST treatment.');
 await page.screenshot({path:'test-results/ipo-revision-approval.png',fullPage:true});
 await back.click();
 await expect(queue).toContainText('CHP-351-R1 returned to Atif with your note.');await expect(queue).toContainText('No IPO revisions are waiting');
 expect(decided).toMatchObject({decision:'Returned',note:'Keep the agreed GST treatment.'});
});
