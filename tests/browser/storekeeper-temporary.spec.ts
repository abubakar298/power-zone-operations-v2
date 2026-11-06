import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
test('storekeeper shell offers scoped temporary documents without dispatcher navigation',async({page})=>{
 await actors(page.request);await login(page.request,'inventory-release@example.test');let writes=0;
 await page.route('**/api/material-dispatches/**',async r=>{const path=new URL(r.request().url()).pathname.replace('/api/material-dispatches','');
  if(path==='/access')return r.fulfill({json:{kind:'storekeeper',warehouses:['Lahore warehouse']}});
  if(path==='/gate-passes')return r.fulfill({json:{kind:'storekeeper',warehouses:['Lahore warehouse'],records:[]}});
  if(path==='/temporary-documents'&&r.request().method()==='GET')return r.fulfill({json:{documents:[],warehouses:['Lahore warehouse'],items:[]}});
  if(path==='/temporary-documents'){writes++;return r.fulfill({json:{...r.request().postDataJSON(),id:'11111111-1111-4111-8111-111111111111',number:'TMP-TEST',version:1,createdAt:'2026-10-29'}});}
  throw Error('Unexpected request '+path);
 });
 await page.goto('/inventory/gate-passes');await page.getByRole('button',{name:'Create Temporary Document',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Create a temporary document',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Material issuance',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Stock Position',exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Warehouse',{exact:true}).getByRole('option')).toHaveText(['Select warehouse','Lahore warehouse']);await page.getByLabel('Warehouse',{exact:true}).selectOption('Lahore warehouse');await page.getByLabel('Supplier, site or destination').fill('Fictional test party');await page.getByRole('button',{name:'Save temporary document',exact:true}).click();await expect(page.getByText('TMP-TEST saved. No stock movement was posted.',{exact:true})).toBeVisible();expect(writes).toBe(1);
});
