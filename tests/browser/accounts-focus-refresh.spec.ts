import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';

// 16 Nov 2026 (Render logs: the Accounts counts ran again 7 seconds later): coming back to the browser
// window re-checks the Accounts work counts only when the last check is at least a minute old. Opening
// the dashboard still checks at once.
test('returning to the window re-checks the Accounts counts only after a minute',async({page})=>{
 await actors(page.request);await login(page.request,'accounts-release@example.test');
 const start=Date.now();await page.clock.install({time:start});
 const counts={queues:0,costing:0};
 await page.route('**/api/accounts-workspace/work-queues',r=>{counts.queues++;return r.fulfill({json:{invoicesToSubmit:2,paymentsToRecord:1}});});
 await page.route('**/api/accounts-workspace/material-costing?summary=1',r=>{counts.costing++;return r.fulfill({json:{count:14}});});
 await page.goto('/dashboard#workspace=finance&accountsTab=My+Workspace');
 const project=page.getByRole('group',{name:'Project accounting work',exact:true});
 await expect(project.getByRole('button').filter({hasText:'Material Costing & PT Entry'}).locator('strong')).toHaveText('14');
 await page.waitForLoadState('networkidle');
 expect(counts,'opening').toEqual({queues:1,costing:1});
 // Switching to another program and back a few seconds later does not run the checks again.
 await page.clock.setSystemTime(start+7_000);
 await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForTimeout(500);await page.waitForLoadState('networkidle');
 expect(counts,'back after 7 seconds').toEqual({queues:1,costing:1});
 // A minute after the last check, coming back checks again (once each).
 await page.clock.setSystemTime(start+61_000);
 await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
 await expect.poll(()=>counts).toEqual({queues:2,costing:2});
});
