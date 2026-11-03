import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';import {openWorkspaceSection,openBoqSection} from './navigation.js';
test('global site search pages every match newest first and retains keyboard navigation',async({page})=>{
 await actors(page.request);await login(page.request);
 const sites=Array.from({length:23},(_,i)=>({id:'paging-'+i,siteName:'Paging site '+String(i).padStart(2,'0'),siteCode:String(i),customer:'UBL',region:'Lahore',stage:'delivery',stageLabel:'Delivery',ipoNumber:'IPO-'+i,boqNumber:'BOQ-'+i,updatedAt:`2026-10-${String(i+1).padStart(2,'0')}T10:00:00Z`}));
 await page.route('**/api/site-workflow',r=>r.fulfill({json:{sites}}));await page.route('**/api/project-workflow/advance-inbox',r=>r.fulfill({json:{requests:[]}}));
 await page.goto('/dashboard#workspace=dashboard');const input=page.locator('.gs input[type="search"]');await input.fill('Paging site');
 const options=page.getByRole('listbox',{name:'Search results'}).getByRole('option'),pager=page.getByRole('navigation',{name:'search results pages'});
 await expect(options).toHaveCount(10);await expect(options.first()).toContainText('Paging site 22');await expect(pager).toContainText('Page 1 of 3');
 await pager.getByRole('button',{name:'Next',exact:true}).click();await expect(options.first()).toContainText('Paging site 12');await input.press('ArrowDown');await expect(options.nth(1)).toHaveAttribute('aria-selected','true');
 await pager.getByRole('button',{name:'Next',exact:true}).click();await expect(options).toHaveCount(3);await expect(pager.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
 await input.fill('Paging site 00');await expect(options).toHaveCount(1);await expect(pager).toHaveCount(0);await input.fill('Paging site');await expect(options.first()).toContainText('Paging site 22');await expect(pager).toContainText('Page 1 of 3');
 await page.screenshot({path:'test-results/global-search-ten-recent.png',fullPage:true});
});
test('BOQ customer lookup offers ten recent registrations and selecting a later page preserves its canonical ID',async({page})=>{
 await actors(page.request);await login(page.request);
 const customers=Array.from({length:23},(_,i)=>({id:1000+i,name:'Paging customer '+String(i).padStart(2,'0'),short_code:'C'+i,status:'Active',contact_person:'',phone:'',email:''}));
 await page.route('**/api/masters',async r=>{const response=await r.fetch(),data=await response.json();return r.fulfill({json:{...data,customers,sites:[]}});});
 await page.goto('/dashboard');await openWorkspaceSection(page,'Survey & BOQ');await page.getByRole('button',{name:'New BOQ',exact:true}).click();
 const customer=page.getByRole('combobox',{name:'Customer',exact:true});await customer.click();const options=page.getByRole('listbox',{name:'Customer matches'}).getByRole('option'),pager=page.getByRole('navigation',{name:'customers pages'});
 await expect(options).toHaveCount(10);await expect(options.first()).toContainText('Paging customer 22');await pager.getByRole('button',{name:'Next',exact:true}).click();await expect(options.first()).toContainText('Paging customer 12');
 await page.screenshot({path:'test-results/customer-search-ten-recent.png',fullPage:true});await options.first().click();await expect(page.locator('input[name="customerId"]')).toHaveValue('1012');await expect(customer).toHaveValue('Paging customer 12');expect(await customer.evaluate((e:HTMLInputElement)=>e.checkValidity())).toBe(true);
 await customer.fill('Paging customer 00');await expect(options).toHaveCount(1);await expect(pager).toHaveCount(0);
});
test('Direct Product Sale shows every product choice and keeps the selected product ID',async({page})=>{
 await actors(page.request);await login(page.request);
 const items=Array.from({length:23},(_,i)=>({key:'P'+String(i).padStart(2,'0'),display_name:'Paging product '+String(i).padStart(2,'0'),status:'Active',unit:'No',approved_specification:'Test fixture'}));
 await page.route('**/api/masters',async r=>{const response=await r.fetch(),data=await response.json();return r.fulfill({json:{...data,items}});});
 await page.goto('/dashboard');await openWorkspaceSection(page,'Survey & BOQ');await page.getByRole('button',{name:'New BOQ',exact:true}).click();await page.getByLabel('BOQ type',{exact:true}).selectOption('direct-product');await openBoqSection(page,2);
 const select=page.getByLabel('Product 1',{exact:true});await expect(select.locator('option[value]:not([value=""]):not([hidden])')).toHaveCount(23);await expect(page.getByRole('navigation',{name:'Product 1 choices pages'})).toHaveCount(0);
 await select.selectOption('P22');await expect(select).toHaveValue('P22');expect(await select.evaluate((e:HTMLSelectElement)=>e.checkValidity())).toBe(true);await expect(page.locator('input[name="directProducts"]')).toHaveValue(/"key":"P22"/);
 await page.getByLabel('Search product 1',{exact:true}).fill('Paging product 22');await expect(select.locator('option[value]:not([value=""]):not([hidden])')).toHaveCount(1);await select.selectOption('P22');await expect(page.locator('input[name="directProducts"]')).toHaveValue(/"key":"P22"/);
});
test('all Operations site buckets page ten and order sites by recorded activity rather than planned dates',async({page})=>{
 await actors(page.request);await login(page.request);
 const sites=Array.from({length:23},(_,i)=>({id:'active-'+i,name:'Active paging site '+String(i).padStart(2,'0'),ipo:'CHP-'+i,stage:'received',installation:true,completed:false,projectType:'ups',operationsTeam:'central',updatedAt:`2026-10-${String(i+1).padStart(2,'0')}T10:00:00Z`,dispatchDate:'2030-01-01',documents:[],history:[],accounts:[],blockers:[],version:1}));
 await page.route('**/api/operations-board/sites',r=>r.fulfill({json:{sites,access:{kind:'owner',team:null,name:'Owner'}}}));await page.route('**/api/operations-board/vendors',r=>r.fulfill({json:{vendors:[]}}));
 await page.goto('/operations/sites');const rows=page.locator('.ob-table tbody tr'),pager=page.getByRole('navigation',{name:'sites pages'});
 await expect(rows).toHaveCount(10);await expect(rows.first()).toContainText('Active paging site 22');await pager.getByRole('button',{name:'Next',exact:true}).click();await expect(rows.first()).toContainText('Active paging site 12');
 await page.getByRole('searchbox',{name:'Search site, IPO or customer PO'}).fill('Active paging site 00');await expect(rows).toHaveCount(1);await expect(pager).toHaveCount(0);await page.getByRole('searchbox',{name:'Search site, IPO or customer PO'}).fill('');await expect(rows.first()).toContainText('Active paging site 22');
});
test('batch site picker retains checked sites from different ten-result pages without saving a dispatch',async({page})=>{
 await actors(page.request);await login(page.request);let writes=0;
 const sites=Array.from({length:23},(_,i)=>({id:'batch-paging-'+i,name:'Batch paging site '+String(i).padStart(2,'0'),ipo:'CHP-'+i,stage:'received',installation:true,completed:false,projectType:'ups',operationsTeam:'central',updatedAt:`2026-10-${String(i+1).padStart(2,'0')}T10:00:00Z`,documents:[],history:[],accounts:[],blockers:[],planningBatches:[],version:1}));
 await page.route('**/api/operations-board/**',r=>{if(r.request().method()!=='GET')writes++;const path=new URL(r.request().url()).pathname;if(path.endsWith('/sites'))return r.fulfill({json:{sites,access:{kind:'owner',team:null,name:'Owner'}}});if(path.endsWith('/batches'))return r.fulfill({json:{batches:[]}});if(path.endsWith('/resources'))return r.fulfill({json:{resources:[]}});return r.fulfill({json:{vendors:[]}});});
 await page.goto('/operations/batches');await page.getByRole('button',{name:'Plan a batch',exact:true}).click();await page.getByLabel('Operations team',{exact:true}).selectOption('central');
 const picker=page.locator('.ob-site-picker'),checks=picker.getByRole('checkbox'),pager=picker.getByRole('navigation',{name:'eligible sites pages'});await expect(checks).toHaveCount(10);await expect(picker).toContainText('Batch paging site 22');await checks.first().check();await pager.getByRole('button',{name:'Next',exact:true}).click();await checks.first().check();await expect(page.locator('.ob-stop-table tbody tr')).toHaveCount(2);await pager.getByRole('button',{name:'Previous',exact:true}).click();await expect(checks.first()).toBeChecked();expect(writes).toBe(0);
});

test('Accounts mixed next actions use one newest-first order and IPO search pages the newest records',async({page})=>{
 await actors(page.request);await login(page.request,'accounts-release@example.test');
 const ipos=Array.from({length:12},(_,i)=>({id:'recent-ipo-'+i,number:'IPO-'+i,created_at:`2026-10-${String(i+1).padStart(2,'0')}T10:00:00Z`,snapshot:{siteName:'Recent Accounts site '+i}}));
 await page.route('**/api/accounts-workspace',r=>r.fulfill({json:{ipos,reviewSamples:[{id:'new-sample',site_name:'Newest approved IPO',kind:'IPO / PT',created_at:'2026-10-24T10:00:00Z',stage:'IPO ready'}],closures:[],ptEntries:[],legacy:[]}}));
 await page.route('**/api/inventory-reconciliation/reports',r=>r.fulfill({json:{reports:[]}}));
 await page.goto('/dashboard#workspace=finance&accountsTab=My+Workspace');
 const list=page.locator('.accounts-next-actions table'),pager=list.getByRole('navigation');await expect(list.locator('tbody tr').first()).toContainText('Newest approved IPO');await expect(list.locator('tbody tr').nth(1)).toContainText('Recent Accounts site 11');await pager.getByRole('button',{name:'Next',exact:true}).click();await expect(list).toContainText('Recent Accounts site 0');
 await page.getByRole('button',{name:'12 IPOs Received 0 recorded in PT',exact:true}).click();await expect(page.locator('.accounts-entry-table tbody tr').first()).toContainText('Recent Accounts site 11');
});
