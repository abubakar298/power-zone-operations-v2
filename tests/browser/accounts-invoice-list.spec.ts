import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
test('invoice lists show ten newest while search and recovery export retain the full filtered set',async({page})=>{
 await actors(page.request);await login(page.request,'accounts-release@example.test');
 const invoices=Array.from({length:13},(_,index)=>({id:'recent-invoice-'+index,invoice:'INV-'+String(index+1).padStart(4,'0'),site:'Recent invoice site '+(index+1),customer:'United Bank Limited',ipo:'IPO-'+index,category:'System',amount:'10000.00',pending:'10000.00',submission:'Submitted',date:'2026-10-'+String(index+1).padStart(2,'0'),receiptConfirmed:false}));
 await page.route('**/api/accounts-workspace/payment-records',route=>route.fulfill({json:{sourceVersion:1,canRecord:true,pending:[],awaiting:invoices,invoices,internet:[],entries:[],receipts:[]}}));
 await page.goto('/dashboard#workspace=finance&accountsTab=Payments+to+Record');
 const total=page.getByRole('status',{name:'Filtered invoice total'});await expect(total).toContainText('130,000.00');
 const list=page.getByRole('table').first();await expect(list.locator('tbody tr')).toHaveCount(10);await expect(list.locator('tbody tr').first()).toContainText('INV-0013');await expect(list).not.toContainText('INV-0001');
 const pager=page.getByRole('navigation',{name:'invoices pages'});await expect(pager).toContainText('Showing 1–10 of 13 invoices');await expect(pager.getByRole('button',{name:'Previous'})).toBeDisabled();await pager.getByRole('button',{name:'Next'}).click();await expect(list.locator('tbody tr')).toHaveCount(3);await expect(total).toContainText('130,000.00');await expect(list).toContainText('INV-0001');await expect(pager.getByRole('button',{name:'Next'})).toBeDisabled();await pager.getByRole('button',{name:'Previous'}).click();await expect(list.locator('tbody tr')).toHaveCount(10);await pager.getByRole('button',{name:'Next'}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery PDF',exact:true}).click();const report=await download;expect(await report.failure()).toBeNull();await report.saveAs('test-results/recent-invoice-export.pdf');
 await page.getByRole('searchbox',{name:'Search invoice, IPO, site or customer',exact:true}).fill('INV-0001');await expect(list.locator('tbody tr')).toHaveCount(1);await expect(list).toContainText('INV-0001');await expect(total).toContainText('10,000.00');
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(list.locator('tbody tr')).toHaveCount(10);
 await page.getByRole('button',{name:/All invoices.*One row per invoice/}).click();await expect(list.locator('tbody tr')).toHaveCount(10);
 await page.getByRole('searchbox',{name:'Search invoice, IPO, site or customer',exact:true}).fill('no matches');await expect(total).toContainText('0.00');
});

test('invoice totals respect customer filters, partial balances and missing values',async({page})=>{
 await actors(page.request);await login(page.request,'accounts-release@example.test');
 const invoices=[{id:'one',invoice:'ONE',customer:'United Bank Limited',site:'One',category:'System',amount:'100.00',pending:'25.15',submission:'Submitted'},{id:'two',invoice:'TWO',customer:'Meezan Bank Limited',site:'Two',category:'System',amount:'200.00',pending:'75.20',submission:'Submitted'},{id:'missing',invoice:'MISSING',customer:'United Bank Limited',site:'Missing',category:'System',amount:null,pending:null,submission:'Submitted'}];
 await page.route('**/api/accounts-workspace/payment-records',route=>route.fulfill({json:{sourceVersion:1,canRecord:true,pending:[],awaiting:invoices,invoices,internet:[],entries:[],receipts:[]}}));
 await page.goto('/dashboard#workspace=finance&accountsTab=Payments+to+Record');
 const total=page.getByRole('status',{name:'Filtered invoice total'});await expect(total).toContainText('100.35');await expect(total).toContainText('1 amount not recorded');
 await page.getByLabel('Customer',{exact:true}).selectOption('United Bank Limited');await expect(total).toContainText('25.15');await expect(total).toContainText('1 amount not recorded');
 await page.getByRole('searchbox',{name:'Search invoice, IPO, site or customer',exact:true}).fill('MISSING');await expect(total).toContainText('Not recorded');await expect(total).not.toContainText('0.00');
});
test('submission total uses the selected milestone and excludes missing values',async({page})=>{
 await actors(page.request);await login(page.request,'accounts-release@example.test');
 await page.route('**/api/accounts-workspace/billing',route=>route.fulfill({json:{asOf:'2026-11-02',rows:[],customers:[]}}));
 await page.route('**/api/accounts-workspace/invoice-entries',route=>route.fulfill({json:{canRecord:true,entries:[],submissionQueues:{deliveryOnly:[],delivery:[{key:'known',site:'Known site',ipo:'IPO-1',program:'Solar 70',milestone:'delivery',advance:{invoiceAmount:'10.25'},completion:{invoiceAmount:'999.00'}},{key:'missing',site:'Missing site',ipo:'IPO-2',milestone:'delivery'}],completion:[]}}}));
 await page.goto('/dashboard#workspace=finance&accountsTab=Invoices+to+Submit');await page.getByRole('button',{name:/^Delivery milestone 2 /}).click();
 const total=page.getByRole('status',{name:'Filtered invoice total'});await expect(total).toContainText('10.25');await expect(total).toContainText('1 amount not recorded');
 await page.getByLabel('Search IPO, site or customer PO').fill('Known');await expect(total).toContainText('10.25');await expect(total).not.toContainText('not recorded');
});
