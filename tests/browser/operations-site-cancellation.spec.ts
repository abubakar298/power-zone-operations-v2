import {test,expect,type Page} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
const open={id:'cancel-me',name:'Cancelled fixture site',ipo:'CHP-901',stage:'received',installation:true,projectType:'ups',operationsTeam:'central',documents:[],history:[],accounts:[],blockers:[],planningBatches:[],version:3};
const other={...open,id:'other',name:'Active fixture site',ipo:'CHP-902'};
const reason='Customer cancelled the PO by email.';
const proof={id:'22222222-2222-4222-8222-222222222222',name:'customer-email.png',mediaType:'image/png'};
const cancelled={...open,cancelled:true,cancellation:{reason,proof:[proof],cancelledBy:'Moaz Ahsan',cancelledAt:'2026-11-12T08:00:00.000Z'},version:4};
async function board(page:Page,kind:'head'|'lead',sites:unknown[]){
 await page.route('**/api/operations-board/sites',r=>r.fulfill({json:{sites,access:{kind,team:kind==='lead'?'central':null,name:kind==='head'?'Moaz Ahsan':'Central lead'}}}));
 await page.route('**/api/operations-board/vendors',r=>r.fulfill({json:{vendors:[]}}));
 await page.route('**/api/operations-board/resources*',r=>r.fulfill({json:{resources:[]}}));
}
test('Operations head cancels a site with a reason; leads do not see the button',async({page})=>{
 await actors(page.request);await login(page.request);
 await board(page,'head',[open,other]);
 let site:unknown=open,body:Record<string,unknown>|undefined;
 await page.route('**/api/operations-board/sites/cancel-me',r=>r.fulfill({json:site}));
 await page.route('**/api/operations-board/sites/cancel-me/files',r=>r.fulfill({json:proof}));
 await page.route('**/api/operations-board/sites/cancel-me/decisions',async r=>{body=r.request().postDataJSON();site=cancelled;await r.fulfill({json:cancelled});});
 await page.goto('/operations/sites/cancel-me');
 await page.getByRole('button',{name:'Cancel site'}).click();
 const panel=page.getByRole('group',{name:'Cancel Cancelled fixture site'});
 await expect(panel).toContainText('Use this only when the customer has cancelled');
 const confirm=panel.getByRole('button',{name:'Cancel site'});await expect(confirm).toBeDisabled();
 await panel.getByLabel('Reason for cancelling (required)').fill(reason);
 await expect(confirm).toBeDisabled(); // proof is still missing
 await panel.getByLabel(/Proof of cancellation/).setInputFiles({name:'customer-email.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10,1])});
 await expect(panel.getByRole('button',{name:'customer-email.png',exact:true})).toBeVisible();
 await expect(confirm).toBeEnabled();
 await page.screenshot({path:'test-results/operations-site-cancellation-confirm.png',fullPage:true});
 await confirm.click();
 const banner=page.getByLabel('Site cancelled',{exact:true});
 await expect(banner).toContainText('Cancelled by Moaz Ahsan on 12 Nov 2026.');await expect(banner).toContainText(reason);
 expect(body).toMatchObject({action:'cancel-site',reason,version:3,proofIds:[proof.id]});
 await expect(banner).toContainText('Proof of cancellation');await expect(banner.getByRole('button',{name:'customer-email.png',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Cancel site'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Assign team'})).toHaveCount(0);
 await page.screenshot({path:'test-results/operations-site-cancelled.png',fullPage:true});
 await page.unrouteAll({behavior:'ignoreErrors'});
 // A lead opens the same site: no Cancel site button.
 await board(page,'lead',[open]);await page.route('**/api/operations-board/sites/cancel-me',r=>r.fulfill({json:open}));
 await page.goto('/operations/sites/cancel-me');await expect(page.getByRole('heading',{name:'Cancelled fixture site'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Cancel site'})).toHaveCount(0);
});
test('cancelled sites leave All sites and show under Cancelled or when searched for',async({page})=>{
 await actors(page.request);await login(page.request);
 await board(page,'head',[cancelled,other]);
 await page.goto('/operations/sites');
 const table=page.locator('.ob-table');
 await expect(table.locator('tbody tr')).toHaveCount(1);await expect(table).toContainText('Active fixture site');
 await page.getByRole('searchbox',{name:'Search site, IPO or customer PO'}).fill('CHP-901');
 await expect(table.locator('tbody tr')).toHaveCount(1);await expect(table).toContainText('Cancelled fixture site');await expect(table).toContainText('Cancelled');
 await page.getByRole('searchbox').fill('');
 await page.getByRole('button',{name:/1 Cancelled Customer cancelled/}).click();
 await expect(table.locator('tbody tr')).toHaveCount(1);await expect(table).toContainText('Cancelled fixture site');
 await page.screenshot({path:'test-results/operations-site-cancelled-list.png',fullPage:true});
});
