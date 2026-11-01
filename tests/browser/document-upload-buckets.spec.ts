import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
for(const kind of ['dispatcher','storekeeper'])test(`${kind} Document Upload excludes the retired IRR bucket without changing saved records`,async({page})=>{
 await actors(page.request);await login(page.request);
 await page.route('**/api/material-dispatches/access',r=>r.fulfill({json:{kind}}));
 const records=[{kind:'dispatch',id:'do-1',number:'DO-KEPT',warehouse:'Lahore warehouse',created_at:'2026-11-01T10:00:00Z',signed_copies:1},{kind:'return',id:'igp-1',number:'IGP-HISTORY-KEPT',warehouse:'Lahore warehouse',created_at:'2026-11-01T10:00:00Z',signed_copies:1}];
 let writes=0;await page.route('**/api/material-dispatches/gate-passes',r=>r.fulfill({json:{kind,warehouses:['Lahore warehouse'],records,signoffs:[{...records[0],signoff:true,siteId:'site-history',siteName:'Historical sign-off'}]}}));
 await page.route('**/api/material-dispatches/gate-pass-copies',r=>{writes++;return r.fulfill({json:{}});});
 await page.goto('/inventory/gate-passes?bucket=irrs');
 await expect(page.getByRole('heading',{name:'Documents Upload',exact:true})).toBeVisible();
 const buckets=page.getByRole('navigation',{name:'Document work buckets',exact:true});await expect(buckets.getByRole('button')).toHaveCount(4);
 await expect(page.getByTestId('document-bucket-irrs')).toHaveCount(0);await expect(buckets).not.toContainText('IRR');
 await expect(page.getByRole('heading',{name:'DOs dispatched',exact:true})).toBeVisible();await expect(page.getByText('DO-KEPT',{exact:true})).toBeVisible();await expect(page.getByText('Historical sign-off',{exact:false})).toHaveCount(0);
 expect(page.url()).not.toContain('bucket=irrs');expect(writes).toBe(0);
 await page.screenshot({path:`test-results/document-buckets-${kind}.png`,fullPage:true});
});
