import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
test('completed jobs show ten latest actual completions and search includes older sites',async({page})=>{
 await actors(page.request);await login(page.request);
 const sites=Array.from({length:13},(_,i)=>({id:'complete-'+i,name:'Completed fixture '+String(i).padStart(2,'0'),ipo:'CHP-'+i,stage:'delivered',installation:true,completed:true,projectType:'ups',operationsTeam:'central',qcJob:{date:'2026-10-'+String(i+1).padStart(2,'0')},dispatchDate:'2026-11-'+String(20-i).padStart(2,'0'),documents:[],history:[],accounts:[],blockers:[],version:1}));
 await page.route('**/api/operations-board/sites',r=>r.fulfill({json:{sites,access:{kind:'owner',team:null,name:'Owner'}}}));
 await page.route('**/api/operations-board/vendors',r=>r.fulfill({json:{vendors:[]}}));
 await page.goto('/operations/sites');
 await page.getByRole('button',{name:/13 Completed Work complete/}).click();
 const table=page.locator('.ob-table');await expect(table.locator('tbody tr')).toHaveCount(10);await expect(table.locator('tbody tr').first()).toContainText('Completed fixture 12');await expect(table.locator('tbody tr').first()).toContainText('13 Oct 2026');await expect(table.locator('tbody tr').last()).toContainText('Completed fixture 03');await expect(page.getByText('Showing 10 of 13 sites',{exact:true})).toBeVisible();
 const pager=page.getByRole('navigation',{name:'sites pages'});await pager.getByRole('button',{name:'Next'}).click();await expect(table.locator('tbody tr')).toHaveCount(3);await expect(table).toContainText('Completed fixture 00');await expect(pager.getByRole('button',{name:'Next'})).toBeDisabled();
 await page.getByRole('searchbox',{name:'Search site, IPO or customer PO'}).fill('Completed fixture 00');await expect(table.locator('tbody tr')).toHaveCount(1);await expect(table).toContainText('Completed fixture 00');await page.getByRole('searchbox').fill('');await expect(table.locator('tbody tr')).toHaveCount(10);
 await page.screenshot({path:'test-results/operations-completed-recent.png',fullPage:true});
});

test('QC completion queue pulses while usage is due and clears after the saved report',async({page})=>{
 await actors(page.request);await login(page.request);
 const site={id:'completed-for-qc',name:'Handover completed',ipo:'CHP-TEST',stage:'delivered',installation:true,completed:true,
  projectType:'ups',operationsTeam:'central',qcJob:{date:'2026-11-11'},documents:[],history:[],accounts:[],blockers:[],version:1};
 let pending=true;
 await page.route('**/api/operations-board/sites',r=>r.fulfill({json:{sites:[
  {...site,qcUsagePending:pending},
  {...site,id:'completed-without-usage',name:'Installation with no material entry required'},
 ],access:{kind:'qc',team:'central',name:'QC'}}}));
 await page.route('**/api/operations-board/sites/completed-for-qc',r=>r.fulfill({json:site}));
 await page.route('**/api/material-dispatches/qc/sites/completed-for-qc/material-usage',r=>r.fulfill({json:{
  records:[{draftId:'pool',siteId:'site-ipo',parent:true,kind:'variable',warehouse:'Lahore warehouse',references:['PDO-TEST'],
   report:pending?null:{version:1,snapshot:{date:'2026-11-11',lines:[{lineKey:'cable',used:'0'}]}},
   lines:[{key:'cable',itemId:'CH-CBL',description:'Cable',unit:'m',issued:null,variable:true}]}],
  evidence:{signedDos:[],noVariableItemsUsed:true,variableSignoff:null},
 }}));
 await page.route('**/api/material-dispatches/site-usage',r=>{
  expect(r.request().postDataJSON().lines[0].used).toBe('0');
  pending=false;
  return r.fulfill({json:{version:1}});
 });
 await page.goto('/operations/sites');
 const queue=page.getByRole('button',{name:/Completed Jobs Awaiting QC/});
 await expect(queue.locator('strong')).toHaveText('1');
 await expect(queue).toHaveCSS('animation-name','ob-usage-border');
 await page.emulateMedia({reducedMotion:'reduce'});
 await expect(queue).toHaveCSS('animation-name','none');
 await expect(queue).toHaveClass(/ob-bucket-usage-due/);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await queue.click();
 await expect(page.locator('.ob-table tbody tr')).toHaveCount(1);
 await page.getByRole('button',{name:'Open site',exact:true}).click();
 await page.getByRole('button',{name:'Open material usage'}).click();
 await page.getByLabel('Usage date').fill('2026-11-11');
 await page.getByLabel('Verification note').fill('Verified zero usage');
 await page.getByLabel('Used CH-CBL').fill('0');
 await page.getByRole('button',{name:'Verify & Save Material Usage'}).click();
 await expect(page.getByText(/Material usage saved for Inventory reconciliation/)).toBeVisible();
 await expect(page.getByLabel('Verification note')).toHaveValue('');
 await page.getByRole('button',{name:/Back to sites/}).click();
 await expect(queue.locator('strong')).toHaveText('0');
 await expect(queue).toHaveCSS('animation-name','none');
 await expect(page.locator('.ob-table tbody tr')).toHaveCount(0);
 await page.getByRole('button',{name:/2 Completed Work complete/}).click();
 await expect(page.locator('.ob-table tbody tr')).toHaveCount(2);
});
