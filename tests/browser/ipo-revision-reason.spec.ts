import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
const ipoId='11111111-1111-4111-8111-111111111111',recordId='22222222-2222-4222-8222-222222222222';

test('IPO revisions shows why it cannot load instead of disappearing',async({page})=>{
 await actors(page.request);await login(page.request,'coordinator-release@example.test');
 const record={id:recordId,version:3,customer:'Elahi Energy',customerCode:'ELEN',site:'Faisalabad',siteCode:'FSD',route:'quick-quote',routeLabel:'Quick BOQ → quotation',stage:'issued',coordinationBucket:'IPOs Shared',nextAction:'Preview',data:{ipoShared:true,ipoId,ipoNumber:'CHP-351',sharedPoReference:'WA-Faisalabad-2026-10-16',sharedPoDate:'2026-10-16'},started_at:new Date().toISOString()};
 await page.route('**/api/project-workflow?*',r=>r.fulfill({json:{records:[record],legacyTasks:[]}}));
 await page.route('**/api/project-workflow/'+recordId,r=>r.fulfill({json:{record,files:[]}}));
 await page.route(`**/api/orders/${ipoId}/ipo.pdf`,r=>r.fulfill({status:404,body:''}));
 let calls=0;
 await page.route(`**/api/project-workflow/${recordId}/ipo-revisions`,r=>{calls++;return r.fulfill({status:409,json:{message:'Only an issued IPO can be revised.'}});});
 await page.goto('/dashboard#workspace=coordination');
 await page.getByRole('button',{name:/^IPOs Shared/}).click();
 await page.getByRole('row').filter({hasText:'Faisalabad'}).getByRole('button',{name:'Preview',exact:true}).click();
 const panel=page.getByRole('region',{name:'IPO revisions'});
 await expect(panel.getByRole('alert')).toHaveText('IPO revision is not available for this IPO: Only an issued IPO can be revised.');
 await expect(panel.getByRole('button',{name:'Revise IPO',exact:true})).toHaveCount(0);
 await panel.getByRole('button',{name:'Try again',exact:true}).click();
 await expect.poll(()=>calls).toBeGreaterThan(1);
});
