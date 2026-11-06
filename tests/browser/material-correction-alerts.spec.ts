import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
const alerts=[{id:'flag',site_name:'Pakpattan',legacy_ipo_number:'306',message:'Reconciliation needs correction:138m red +120m black. Closed job remains unchanged.'}];
test('Accounts sees documentary correction alerts without reopening closed-job tasks',async({page})=>{
 await actors(page.request);await login(page.request,'accounts-release@example.test');
 await page.route('**/api/accounts-workspace',r=>r.fulfill({json:{ipos:[],closures:[],ptEntries:[]}}));
 await page.route('**/api/inventory-reconciliation/reports',r=>r.fulfill({json:{reports:[]}}));
 await page.route('**/api/accounts-workspace/work-queues',r=>r.fulfill({json:{invoicesToSubmit:0,paymentsToRecord:0}}));
 await page.route('**/api/accounts-workspace/material-costing?summary=1',r=>r.fulfill({json:{count:0}}));
 await page.route('**/api/accounts-workspace/material-corrections',r=>r.fulfill({json:{alerts}}));
 await page.goto('/dashboard#workspace=finance&accountsTab=My+Workspace');
 await expect(page.getByRole('heading',{name:'Reconciliation corrections · 1',exact:true})).toBeVisible();await expect(page.getByText(alerts[0].message,{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Flag reconciliation correction',exact:true})).toHaveCount(0);
});
test('Inventory Parent register shows the same alert without exposing Accounts write controls',async({page})=>{
 await actors(page.request);await login(page.request);
 await page.route('**/api/material-dispatches/parent-reviewed-ledger',r=>r.fulfill({json:{groups:[]}}));
 await page.route('**/api/material-dispatches/drafts',r=>r.fulfill({json:{drafts:[]}}));
 await page.route('**/api/material-dispatches/material-corrections',r=>r.fulfill({json:{alerts}}));
 await page.goto('/inventory/parent-dos/review');await expect(page.getByText(alerts[0].message,{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Flag reconciliation correction',exact:true})).toHaveCount(0);
});
