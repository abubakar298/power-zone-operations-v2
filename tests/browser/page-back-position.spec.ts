import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
// The Back button sits above the page title (inside the page), not in the top bar,
// and pages no longer have Refresh buttons.
test('Back sits above the page content and works; no Refresh buttons',async({page})=>{
 await actors(page.request);await login(page.request);
 const sites=[{id:'site-1',name:'Back fixture site',ipo:'CHP-1',stage:'received',installation:true,projectType:'ups',operationsTeam:'central',documents:[],history:[],accounts:[],blockers:[],planningBatches:[],version:1}];
 await page.route('**/api/operations-board/sites',r=>r.fulfill({json:{sites,access:{kind:'owner',team:null,name:'Owner'}}}));
 await page.route('**/api/operations-board/vendors',r=>r.fulfill({json:{vendors:[]}}));
 await page.goto('/operations/sites');
 await page.getByRole('button',{name:/1 Assign team/}).click();
 const back=page.locator('.pz-back-button:not(.pz-dialog-back)');
 await expect(back).toHaveCount(1);
 await expect(page.locator('header .pz-back-button')).toHaveCount(0);
 await expect(page.locator('main .pz-page-back .pz-back-button')).toBeVisible();
 const [backBox,titleBox]=[await back.boundingBox(),await page.getByRole('heading',{name:'Site updates'}).boundingBox()];
 expect(backBox!.y).toBeLessThan(titleBox!.y);
 await expect(page.getByRole('button',{name:/^Refresh/})).toHaveCount(0);
 await page.screenshot({path:'test-results/page-back-position.png'});
 await back.click();await expect(page.getByRole('heading',{name:'All sites'})).toBeVisible();
});
