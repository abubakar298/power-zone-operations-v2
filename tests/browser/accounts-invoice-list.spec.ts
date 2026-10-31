import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
test('invoice lists show ten newest while search and recovery export retain the full filtered set',async({page})=>{
 await actors(page.request);await login(page.request,'accounts-release@example.test');
 const invoices=Array.from({length:13},(_,index)=>({id:'recent-invoice-'+index,invoice:'INV-'+String(index+1).padStart(4,'0'),site:'Recent invoice site '+(index+1),customer:'United Bank Limited',ipo:'IPO-'+index,category:'System',amount:'10000.00',pending:'10000.00',submission:'Submitted',date:'2026-10-'+String(index+1).padStart(2,'0'),receiptConfirmed:false}));
 await page.route('**/api/accounts-workspace/payment-records',route=>route.fulfill({json:{sourceVersion:1,canRecord:true,pending:[],awaiting:invoices,invoices,internet:[],entries:[],receipts:[]}}));
 await page.goto('/dashboard#workspace=finance&accountsTab=Payments+to+Record');
 const list=page.getByRole('table').first();await expect(list.locator('tbody tr')).toHaveCount(10);await expect(list.locator('tbody tr').first()).toContainText('INV-0013');await expect(list).not.toContainText('INV-0001');
 await expect(page.getByText('Showing the 10 most recent of 13 matching invoices. Search or filter to find another invoice.',{exact:true})).toBeVisible();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery PDF',exact:true}).click();const report=await download;expect(await report.failure()).toBeNull();await report.saveAs('test-results/recent-invoice-export.pdf');
 await page.getByRole('searchbox',{name:'Search invoice, IPO, site or customer',exact:true}).fill('INV-0001');await expect(list.locator('tbody tr')).toHaveCount(1);await expect(list).toContainText('INV-0001');
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(list.locator('tbody tr')).toHaveCount(10);
 await page.getByRole('button',{name:/All invoices.*One row per invoice/}).click();await expect(list.locator('tbody tr')).toHaveCount(10);
});
