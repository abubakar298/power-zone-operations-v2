import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
import {xlsxBook} from '../../server/procurement/xlsx.js';
test('Accounts invoice workbook opens as a popup preview and downloads only on request',async({page})=>{
 await actors(page.request);await login(page.request,'accounts-release@example.test');
 await page.route('**/api/accounts-workspace/billing',r=>r.fulfill({json:{rows:[],customers:[]}}));
 await page.route('**/api/accounts-workspace/invoice-entries',r=>r.fulfill({json:{canRecord:true,entries:[],submissionQueues:{deliveryOnly:[{key:'workbook',site:'Workbook invoice site',ipo:'IPO-TEST',customer:'Meezan Bank',milestone:'deliveryOnly',evidence:[{id:'file',filename:'Consolidated.xlsx',url:'/api/test-invoice.xlsx'}]}],delivery:[],completion:[]}}}));
 await page.route('**/api/test-invoice.xlsx',r=>r.fulfill({contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',headers:{'Content-Disposition':'attachment; filename="Consolidated.xlsx"'},body:xlsxBook([{name:'Invoice',rows:[['Site','Amount'],['Test branch',28600]]}])}));
 let downloads=0;page.on('download',()=>downloads++);await page.goto('/dashboard#workspace=finance&accountsTab=Invoices+to+Submit');await page.getByRole('button',{name:/^Delivery-only 1 /}).click();await page.getByRole('button',{name:'Record invoice',exact:true}).click();await page.getByRole('button',{name:'Consolidated.xlsx',exact:true}).click();const preview=page.getByRole('dialog',{name:'Consolidated.xlsx',exact:true});await expect(preview.getByRole('table',{name:'Invoice'})).toContainText('Test branch');await expect(preview).toContainText('28600');expect(downloads).toBe(0);
 const download=page.waitForEvent('download');await preview.getByRole('button',{name:'Download',exact:true}).click();const file=await download;expect(file.suggestedFilename()).toBe('Consolidated.xlsx');await preview.getByRole('button',{name:'Close record',exact:true}).click();await expect(page.getByRole('dialog',{name:'Workbook invoice site',exact:true})).toBeVisible();
});
