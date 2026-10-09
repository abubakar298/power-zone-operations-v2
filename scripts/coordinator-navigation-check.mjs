// Focused frontend checks against disposable API fixtures; never touches business data.
import {chromium} from '@playwright/test';
import {strict as assert} from 'node:assert';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
page.on('console',m=>{if(m.type()==='error')console.log(m.text())});page.on('requestfailed',r=>console.log(r.url(),r.failure()));
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const session={user:{id:'fixture',displayName:'Atif Fixture',role:'Coordinator',email:'fixture@example.invalid'},csrfToken:'fixture',expiresAt:'2030-01-01'};
const masters={customers:[{id:1,name:'Fixture Bank',short_code:'FB',status:'Active'}],sites:[{id:1,customer_id:1,customer_name:'Fixture Bank',name:'HQ',code:'HQ',status:'Active'}],brands:[],rates:[],rules:[],items:[],inverters:[],classifications:[],imports:[],bess:[]};
const task={id:'draft',kind:'Survey / BOQ',draft_id:'draft',target:'boqs',site:'HQ',reference:'Fixture survey',status:'Draft',stage:'Survey & Costing Preparation',responsibility:'Coordinator',started_at:new Date().toISOString()};
const routes={
 '/auth/status':{setupRequired:false},'/auth/session':session,'/dashboard':{user:session.user},'/notifications':{notifications:[],unreadCount:0,hasMore:false},'/notifications/preferences':{email_enabled:true},'/masters':masters,
 '/coordinator':{tasks:[task],performance:{},counts:{}},'/boqs':{boqs:[]},'/boqs/drafts':{drafts:[]},'/boqs/reviews':{reviews:[]},'/commercial/quotations':{quotations:[]},'/orders':{orders:[]},'/orders/submissions':{submissions:[]},'/operations/portal':{issuances:[],tasks:[],stageCounts:{}},'/cni':{proposals:[]},'/commercial/pricing':{pricing:[]},'/commercial/standard-policy':{version:1,categories:[]},'/commercial/revision-requests':{requests:[]},
};
const unexpected=[];
await page.route('**/api/**',route=>{const p=new URL(route.request().url()).pathname.replace('/api','');if(!(p in routes))unexpected.push(p);return route.fulfill({json:routes[p]??{}})});
await page.goto('http://127.0.0.1:5178');

const nav=page.getByRole('navigation',{name:'Main navigation',exact:true});
for(const label of ['My Workspace','Projects','New BOQ','Documents','Customers & Sites','Rate Master'])await nav.getByRole('button',{name:label,exact:true}).waitFor();
assert.equal(await nav.getByRole('button').count(),6);
await page.getByRole('combobox',{name:'Stage',exact:true}).selectOption('Revision required');
await nav.getByRole('button',{name:'Documents',exact:true}).click();
await page.getByRole('heading',{name:'Document library'}).waitFor();
await page.getByLabel('Customer filter',{exact:true}).selectOption('Fixture Bank');
await page.getByLabel('Site filter',{exact:true}).selectOption('HQ');
await nav.getByRole('button',{name:'Projects',exact:true}).click();
await page.getByRole('heading',{name:'Customer & site work'}).waitFor();
for(const label of ['Surveys & BOQs','Quotations','IPOs','BOQs to Operations'])await page.getByRole('button',{name:label,exact:true}).waitFor();
await page.getByRole('button',{name:'Surveys & BOQs',exact:true}).click();
await page.getByRole('button',{name:'← Back to Projects'}).click();
assert.equal(await page.getByLabel('Customer filter',{exact:true}).inputValue(),'Fixture Bank');
assert.equal(await page.getByLabel('Site filter',{exact:true}).inputValue(),'HQ');
for(const label of ['Quotations','IPOs','BOQs to Operations']){await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('button',{name:'← Back to Projects'}).waitFor();await page.getByRole('button',{name:'← Back to Projects'}).click();await page.getByRole('heading',{name:'Customer & site work'}).waitFor();}
await nav.getByRole('button',{name:'My Workspace',exact:true}).click();
assert.equal(await page.getByRole('combobox',{name:'Stage',exact:true}).inputValue(),'Revision required');
await nav.getByRole('button',{name:'Customers & Sites',exact:true}).click();
await page.getByRole('tab',{name:/^Customers/}).waitFor();
assert.equal(await page.getByRole('tab').count(),2);
await nav.getByRole('button',{name:'Rate Master',exact:true}).click();
await page.getByRole('tab',{name:/^Rates/}).waitFor();
assert.equal(await page.getByRole('tab').count(),4);
await nav.getByRole('button',{name:'New BOQ',exact:true}).click();
await page.getByRole('combobox',{name:'Document action',exact:true}).waitFor();
await page.setViewportSize({width:390,height:844});
await page.getByRole('button',{name:'Toggle navigation',exact:true}).click();
await nav.getByRole('button',{name:'My Workspace',exact:true}).click();
assert.equal(await page.getByRole('button',{name:'Toggle navigation',exact:true}).getAttribute('aria-expanded'),'false');
assert.deepEqual(errors,[]);
assert.deepEqual(unexpected,[]);
await browser.close();
console.log('PASS: six destinations, existing workflow entry points, customer/site and stage retention, scoped masters, direct New BOQ, mobile menu; no runtime errors or unexpected API requests.');
