import {openWorkspaceSection} from "./navigation.js";
import {test,expect} from '@playwright/test';
test('Direct Product Sale has product-only inputs and existing quotation preparation with package grouping',async({page})=>{
 page.on('dialog',dialog=>dialog.accept());
 const origin=`http://127.0.0.1:${process.env.PZ_E2E_PORT ?? '3180'}`;
 expect((await page.request.post('/api/auth/setup',{headers:{Origin:origin},data:{email:'products@example.test',displayName:'Product test admin',password:'browser-test-passphrase-298',setupToken:'browser-test-setup-key-isolated-only'}})).status()).toBe(201);
 await page.goto('/login');await page.getByLabel('Email address').fill('products@example.test');await page.getByLabel('Password',{exact:true}).fill('browser-test-passphrase-298');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await openWorkspaceSection(page, 'Survey & BOQ');await page.getByRole('button',{name:'New BOQ',exact:true}).click();await page.getByLabel('BOQ type',{exact:true}).selectOption('direct-product');
 for(const label of ['Panel quantity','Panel wattage (W)','BESS configuration','6mm² DC cable total (m)','Structure','Inverter brand','Cable brand'])await expect(page.getByLabel(label,{exact:true})).toHaveCount(0);
 const customer=page.getByRole('combobox',{name:'Customer',exact:true});await customer.fill('Alfalah');await page.getByRole('option',{name:/Alfalah/}).click();await page.getByLabel('New site name',{exact:true}).fill('Product sale 99001');
 await page.getByLabel('Product 1 selection type',{exact:true}).selectOption('bess');await page.getByLabel('Product 1',{exact:true}).selectOption('6-10');await page.getByLabel('Product 1 quantity',{exact:true}).fill('2');await page.getByRole('button',{name:'Add product / BESS package',exact:true}).click();await page.getByLabel('Product 2',{exact:true}).selectOption('Extra Smart Meter');await page.getByLabel('Product 2 quantity',{exact:true}).fill('3');
 const previewResponse=page.waitForResponse(r=>r.url().endsWith('/api/boqs/preview')&&r.request().method()==='POST');await page.getByRole('button',{name:'Calculate & review BOQ',exact:true}).click();const response=await previewResponse;expect(response.status(),await response.text()).toBe(200);const preview=await response.json();expect(preview.snapshot.survey.family).toBe('direct-product');expect(preview.snapshot.lines).toHaveLength(4);
 await page.getByRole('button',{name:'Create quotation',exact:true}).click();await expect(page.getByLabel('Price presentation',{exact:true})).toBeVisible();await expect(page.getByLabel('Price presentation',{exact:true}).locator('option')).toHaveText(['No Breakup','Breakup']);
 await page.getByLabel('Price presentation',{exact:true}).selectOption('Full Breakup');await page.getByLabel('Complete BESS package pricing',{exact:true}).selectOption('grouped');
 const pricingResponse=page.waitForResponse(r=>r.url().endsWith('/api/commercial/pricing/preview')&&r.request().method()==='POST');await page.getByRole('button',{name:'Calculate selling price',exact:true}).click();const priced=await pricingResponse;expect(priced.status(),await priced.text()).toBe(200);expect((await priced.json()).snapshot.input.groupBessPackages).toBe(true);
 await page.screenshot({path:'output/direct-product-browser.png',fullPage:true});
 await page.getByRole('button',{name:'Create quotation',exact:true}).click();await expect(page.getByRole('button',{name:'Save draft quotation',exact:true})).toBeVisible();
});
