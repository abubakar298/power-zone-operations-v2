import {test,expect} from '@playwright/test';
import {openWorkspaceSection} from './navigation.js';
test('PT catalogue keeps brand stock identities and shows shared current rates',async({page})=>{
 const origin=`http://127.0.0.1:${process.env.PZ_E2E_PORT??'3180'}`;
 expect((await page.request.post('/api/auth/setup',{headers:{Origin:origin},data:{email:'catalogue@example.test',displayName:'Catalogue review',password:'browser-test-passphrase-298',setupToken:'browser-test-setup-key-isolated-only'}})).status()).toBe(201);
 await page.goto('/login');await page.getByLabel('Email address').fill('catalogue@example.test');await page.getByLabel('Password',{exact:true}).fill('browser-test-passphrase-298');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await openWorkspaceSection(page,'Master data');await page.getByRole('button',{name:'PT Item catalogue & approved rules',exact:true}).click();
 await expect(page.getByText('126 of 126 items',{exact:true})).toBeVisible();
 await page.getByLabel('Search Item ID or description').fill('CH-CBL-AC-6MM/1C-RB');await expect(page.getByText('2 of 126 items',{exact:true})).toBeVisible();
 await page.getByLabel('Brand',{exact:true}).selectOption('Newage Cables');await expect(page.getByText('1 of 126 items',{exact:true})).toBeVisible();await expect(page.getByRole('cell').filter({hasText:'CH-CBL-AC-6MM/1C-RB-NA'}).first()).toBeVisible();
 await page.screenshot({path:'/tmp/inventory-catalogue-browser.png',fullPage:true});
 const data=await (await page.request.get('/api/masters')).json();const variants=data.catalogue.filter((r:any)=>['CH-CBL-AC-6MM/1C-RB-NA','CH-CBL-AC-6MM/1C-RB-AOB'].includes(r.item_id));expect(variants).toHaveLength(2);expect(variants[0].rate_key).toBe(variants[1].rate_key);
});
