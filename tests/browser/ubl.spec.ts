import {test,expect} from '@playwright/test';
test('UBL four configurations preserve original scope, dated budgets and commercial history',async({page})=>{
 page.on('dialog',d=>d.accept());
 const origin=`http://127.0.0.1:${process.env.PZ_E2E_PORT??'3180'}`;
 expect((await page.request.post('/api/auth/setup',{headers:{Origin:origin},data:{email:'ubl-admin@example.test',displayName:'UBL admin',password:'browser-test-passphrase-298',setupToken:'browser-test-setup-key-isolated-only'}})).status()).toBe(201);
 await page.goto('/login');await page.getByLabel('Email address').fill('ubl-admin@example.test');await page.getByLabel('Password',{exact:true}).fill('browser-test-passphrase-298');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('button',{name:'Customers & Sites',exact:true})).toBeVisible();
 await page.goto('/dashboard#workspace=ubl&configuration=30-30-40');
 await expect(page.getByRole('heading',{name:'30-30-40 · UBL Hybrid Solar'})).toBeVisible();
 for(const id of ['20-20-30','25-20-30','30-30-40','35-30-40'])await expect(page.getByRole('button',{name:`Open ${id}`,exact:true})).toBeVisible();
 const row=page.getByRole('row').filter({has:page.getByRole('cell',{name:'E19',exact:true})});await expect(row).toContainText('16 mm');
 await page.getByRole('button',{name:'Original agreed BOQ',exact:true}).click();await expect(row).toContainText('25 mm');
 const download=page.waitForEvent('download');await page.getByRole('link',{name:'Download original Financial Proposal R3'}).click();expect((await download).suggestedFilename()).toContain('Opt C');
 await page.getByRole('button',{name:'Negotiation history',exact:true}).click();await expect(page.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Revised',exact:true})}).getByRole('cell',{name:'7,200,000.00',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Budget versions',exact:true}).click();await page.getByLabel('Budget refresh reason').fill('Initial checked budget');await page.getByRole('button',{name:'Create initial dated budget',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'New budget version saved'})).toBeVisible();
 await expect(page.getByText('Inputs awaiting review',{exact:true})).toBeVisible();await expect(page.getByText('Overall budgeted markup: Unresolved',{exact:false})).toBeVisible();
 await page.getByLabel('Budget refresh reason').fill('New dated refresh');await page.getByRole('button',{name:'Refresh costs — create new version',exact:true}).click();await expect(page.getByLabel('Saved budget').locator('option')).toHaveCount(2);await page.getByLabel('Saved budget').selectOption('1');await expect(page.getByText('Refresh reason: Initial checked budget',{exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/ubl-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'output/ubl-budget.png',fullPage:true});await page.reload();await expect(page.getByRole('heading',{name:'30-30-40 · UBL Hybrid Solar'})).toBeVisible();
});
