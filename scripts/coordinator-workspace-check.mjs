// Focused frontend checks against disposable API fixtures; never touches business data.
import {chromium} from '@playwright/test';
import {strict as assert} from 'node:assert';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();

const errors=[];page.on('pageerror',e=>errors.push(e.message));
const session={user:{id:'fixture',displayName:'Atif Fixture',role:'Coordinator',email:'fixture@example.invalid'},csrfToken:'fixture',expiresAt:'2030-01-01'};
const masters={customers:[{id:1,name:'Fixture Bank',short_code:'FB',status:'Active'}],sites:[{id:1,customer_id:1,customer_name:'Fixture Bank',name:'HQ',code:'HQ',status:'Active'}],brands:[],rates:[],rules:[],items:[],inverters:[],classifications:[],imports:[],bess:[]};
const task={id:'draft',kind:'Survey / BOQ',draft_id:'draft',target:'boqs',site:'HQ',reference:'Fixture survey',status:'Draft',stage:'Survey & Costing Preparation',responsibility:'Coordinator',started_at:new Date().toISOString()};
const routes={
 '/auth/status':{setupRequired:false},'/auth/session':session,'/dashboard':{user:session.user},'/notifications':{notifications:[],unreadCount:0,hasMore:false},'/notifications/preferences':{email_enabled:true},'/masters':masters,
 '/coordinator':{tasks:[task],performance:{},counts:{}},'/boqs':{boqs:[]},'/boqs/drafts':{drafts:[]},'/boqs/reviews':{reviews:[]},'/commercial/quotations':{quotations:[]},'/orders':{orders:[]},'/orders/submissions':{submissions:[]},'/operations/portal':{issuances:[],tasks:[],stageCounts:{}},'/cni':{proposals:[]},'/commercial/pricing':{pricing:[]},'/commercial/standard-policy':{version:1,categories:[]},'/commercial/revision-requests':{requests:[]},
};

const stages=['Survey & Costing Preparation','Quotation approval','Revision required','Customer confirmation','IPO approval','Operations & Accounts Handoff'];
const tasks=stages.map((stage,i)=>({...task,id:`work-${i}`,reference:`DOC-${i}`,customer:i===0?'Alpha Bank':'Beta Bank',site:`Site-${i}`,stage,responsibility:[1,4].includes(i)?'Management':i===3?'Customer':'Coordinator',started_at:new Date(Date.now()-(i+1)*60000).toISOString(),target_minutes:i===2?1:null}));
tasks[0]={...tasks[0],id:'draft',draft_id:'draft'};
tasks[1]={...tasks[1],id:'cni-specific',kind:'C&I proposal',target:'quotes',draft_id:null};
routes['/coordinator']={tasks,total:tasks.length};
routes['/cni/cni-specific']={id:'cni-specific',versions:[],actions:[]};
routes['/boqs/drafts']={drafts:[{id:'draft',version:1,inputs:{customerId:1,siteName:'Site-0',siteCode:'HQ',uploadIds:[],family:'solar-hybrid'},review_status:'Draft'}]};
const requests=[];
await page.route('**/api/**',route=>{assert.equal(route.request().method(),'GET','workspace interactions never mutate records');const p=new URL(route.request().url()).pathname.replace('/api','');requests.push(p);return route.fulfill({json:routes[p]??{}})});
await page.goto('http://127.0.0.1:5178');
const panel=page.locator('.coordinator-panel');const rows=()=>panel.locator('tbody tr');
await page.getByRole('heading',{name:'My Next Actions (3)',exact:true}).waitFor();
assert.equal(await rows().count(),3);assert.match(await rows().first().innerText(),/DOC-2/);
assert.equal(await panel.locator('.stage-card').count(),6);
for(const card of await panel.locator('.stage-card').all())assert.equal(await card.locator('strong').innerText(),'1');
await page.getByLabel('Search work',{exact:true}).fill('Alpha');assert.equal(await rows().count(),1);
await page.getByRole('button',{name:'Prepare BOQ',exact:true}).click();await page.getByRole('combobox',{name:'Document action',exact:true}).waitFor();
assert.equal(await page.getByLabel('New site name',{exact:true}).inputValue(),'Site-0');
await page.getByRole('button',{name:'← Back to My Workspace',exact:true}).click();assert.equal(await page.getByLabel('Search work',{exact:true}).inputValue(),'Alpha');
await page.getByLabel('Search work',{exact:true}).fill('');
await page.getByRole('button',{name:'Waiting on Others (3)',exact:true}).click();assert.equal(await rows().count(),3);
await page.getByRole('heading',{name:'Waiting on Others (3)',exact:true}).waitFor();
await page.getByRole('combobox',{name:'Stage',exact:true}).selectOption('Quotation approval');assert.equal(await rows().count(),1);
await page.getByRole('button',{name:'View approval',exact:true}).click();await page.getByRole('heading',{name:'C&I quotation review',exact:true}).waitFor();assert.ok(requests.includes('/cni/cni-specific'));
await page.getByRole('button',{name:'Back to dashboard',exact:true}).click();assert.equal(await page.getByRole('combobox',{name:'Stage',exact:true}).inputValue(),'Quotation approval');
await page.getByRole('button',{name:'All pending tasks',exact:true}).click();assert.equal(await rows().count(),6);
await page.getByLabel('Overdue only',{exact:true}).check();assert.equal(await rows().count(),1);assert.match(await rows().first().innerText(),/DOC-2/);
for(const card of await panel.locator('.stage-card').all())assert.equal(await card.locator('strong').innerText(),'1');
await page.getByLabel('Overdue only',{exact:true}).uncheck();await page.getByLabel('Sort by',{exact:true}).selectOption('oldest');assert.match(await rows().first().innerText(),/DOC-5/);
await page.getByLabel('Sort by',{exact:true}).selectOption('newest');assert.match(await rows().first().innerText(),/DOC-0/);
await page.getByLabel('Search work',{exact:true}).fill('no-match');await page.getByText(/No documents match these filters/).waitFor();
await page.getByLabel('Search work',{exact:true}).fill('');
await page.setViewportSize({width:390,height:844});assert.ok(await page.getByLabel('Search work',{exact:true}).isVisible());
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
await page.getByLabel('Search work',{exact:true}).focus();assert.notEqual(await page.getByLabel('Search work',{exact:true}).evaluate(e=>getComputedStyle(e).outlineStyle),'none');
await page.screenshot({path:'/tmp/pz-workspace-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'/tmp/pz-workspace-desktop.png',fullPage:true});
assert.deepEqual(errors,[]);await browser.close();
console.log('PASS: six independent bucket counts; action/waiting groups; priority and age sorting; customer/document search; overdue and stage filters; exact draft and C&I navigation; filter retention; empty state; mobile containment and keyboard focus; GET-only requests.');
