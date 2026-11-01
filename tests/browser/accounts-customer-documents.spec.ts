import {test,expect} from '@playwright/test';
import {jsPDF} from 'jspdf';
import {actors,login} from './release-fixtures.js';
const docs=Array.from({length:13},(_,i)=>({id:'signed-'+i,siteId:'site-'+i,siteName:'QC Site '+(i+1),customer:i%2?'Meezan Bank':'United Bank Limited',ipo:'IPO-'+i,kind:['Signed DO','VSO','Acknowledgment'][i%3],filename:'Signed-customer-'+i+'.pdf',receivedAt:'2026-10-'+String(31-i).padStart(2,'0')+'T10:00:00Z',documentDate:'2026-10-20',source:'QC',sourceVersion:2,downloadUrl:'/api/accounts-workspace/customer-documents/signed-'+i+'/file'}));
docs.push({...docs[12],id:'site13-vso',kind:'VSO',downloadUrl:'/api/site13-vso'},{...docs[12],id:'site13-ack',kind:'Acknowledgment',downloadUrl:'/api/site13-ack'});
async function mocks(page:any){
 await page.route('**/api/accounts-workspace/site-local-purchases?siteId=*',(r:any)=>r.fulfill({json:{version:1,items:[{key:'local-1',itemId:'CH-PVC-TAPE',description:'Local insulation tape',quantity:'3'}]}}));
 await page.route('**/api/accounts-workspace', (r:any)=>r.fulfill({json:{ipos:[],closures:[],ptEntries:[{source_kind:'Inventory',source_id:'recorded',source_version:1,pt_reference:'PT-KEPT',entry_date:'2026-10-31'}]}}));
 await page.route('**/api/accounts-workspace/work-queues',(r:any)=>r.fulfill({json:{invoicesToSubmit:0,paymentsToRecord:0}}));
 await page.route(/\/api\/accounts-workspace\/customer-documents(?:\?summary=1)?$/,(r:any)=>r.fulfill({json:r.request().url().includes('summary=1')?{count:new Set(docs.map(d=>d.siteId)).size}:{rows:docs}}));
}
test('QC approved documents are immediate, searchable, limited to ten recent and have no PT action or Inventory dependency',async({page})=>{
 await actors(page.request);await login(page.request,'accounts-release@example.test');await mocks(page);
 let inventoryRequests=0;await page.route('**/api/inventory-reconciliation/reports',r=>{inventoryRequests++;return r.fulfill({json:{reports:[]}});});
 await page.goto('/dashboard#workspace=finance&accountsTab=Approved+Documents');
 const table=page.locator('.accounts-signed-document-table');await expect(table.locator('tbody tr')).toHaveCount(10);expect(inventoryRequests).toBe(0);await expect(table).toContainText('QC Site 1');await expect(table).not.toContainText('QC Site 13');
 const pager=page.getByRole('navigation',{name:'sites pages'});await pager.getByRole('button',{name:'Next'}).click();await expect(table.locator('tbody tr')).toHaveCount(3);await expect(table).toContainText('QC Site 13');await expect(table.locator('tbody tr').first().locator('td').first()).toHaveText('11');await pager.getByRole('button',{name:'Previous'}).click();await expect(table.locator('tbody tr')).toHaveCount(10);await pager.getByRole('button',{name:'Next'}).click();
 await expect(page.getByRole('button',{name:'Record PT entry',exact:true})).toHaveCount(0);
 const toolbar=page.locator('.accounts-signed-document-filters');const controls=await toolbar.locator('input,select,button').evaluateAll(elements=>elements.map(e=>e.getBoundingClientRect().top));expect(Math.max(...controls)-Math.min(...controls)).toBeLessThan(2);
 await page.getByRole('searchbox',{name:'Search site or IPO',exact:true}).fill('QC Site 13');await expect(table.locator('tbody tr')).toHaveCount(1);await page.getByRole('button',{name:'View documents',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog.getByRole('heading',{name:'Local Purchase Items',exact:true})).toBeVisible();await expect(dialog).toContainText('Local insulation tape');await expect(dialog).toContainText('QC Site 13');await expect(dialog.getByRole('button',{name:'VSO',exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Acknowledgment',exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Signed DO',exact:true})).toBeVisible();let downloads=0;page.on('download',()=>downloads++);await page.route('**'+docs[12].downloadUrl,r=>r.fulfill({contentType:'image/png',headers:{'Content-Disposition':'attachment; filename=original.png'},body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6i8AAAAASUVORK5CYII=','base64')}));await dialog.getByRole('button',{name:'Signed DO',exact:true}).click();await expect(dialog.getByRole('img',{name:'Signed DO',exact:true})).toBeVisible();await expect(dialog.getByRole('img',{name:'Signed DO',exact:true})).toHaveJSProperty('naturalWidth',1);expect(downloads).toBe(0);await expect(dialog.getByRole('button',{name:'Download',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Close record'}).click();await page.getByRole('button',{name:'Clear filters',exact:true}).click();
 await page.getByRole('combobox',{name:'Document type',exact:true}).selectOption('VSO');await expect(table.locator('tbody tr')).toHaveCount(5);
 await page.getByRole('combobox',{name:'Customer',exact:true}).selectOption('Meezan Bank');await expect(table.locator('tbody tr')).toHaveCount(2);
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();await page.screenshot({path:'../qc-accounts-approved-documents-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'../qc-accounts-approved-documents-mobile.png',fullPage:true});const widths=await page.evaluate(()=>({body:document.body.scrollWidth,viewport:innerWidth}));expect(widths.body).toBeLessThanOrEqual(widths.viewport);
});
test('Accounts dashboard has one material PT bucket and retains the document library',async({page})=>{
 await actors(page.request);await login(page.request,'accounts-release@example.test');await mocks(page);
 await page.route('**/api/inventory-reconciliation/reports',r=>r.fulfill({json:{reports:[]}}));
 await page.route('**/api/accounts-workspace/material-costing?summary=1',r=>r.fulfill({json:{count:14}}));
 await page.goto('/dashboard#workspace=finance&accountsTab=My+Workspace');
 const project=page.getByRole('group',{name:'Project accounting work',exact:true}),billing=page.getByRole('region',{name:'Invoicing & Payments',exact:true});
 await expect(project.getByRole('button')).toHaveCount(4);await expect(project.getByRole('button').filter({hasText:'Material Costing & PT Entry'}).locator('strong')).toHaveText('14');await expect(project).not.toContainText('Approved Documents');await expect(project).not.toContainText('Inventory Reconciliations');await expect(billing.getByRole('button')).toHaveCount(2);
 await page.getByRole('button',{name:'Document Library',exact:true}).click();await expect(page.getByRole('heading',{name:'Document Library',exact:true})).toBeVisible();await expect(page.locator('.accounts-signed-document-table tbody tr')).toHaveCount(10);
});
test('legacy Inventory PT links open the combined site review with in-place document preview',async({page})=>{
 await actors(page.request);await login(page.request,'accounts-release@example.test');await mocks(page);
 const record={id:'report-site',job_key:'ubl:7',site_name:'Specific Site',job_id:'CHP-302',version:1,stage:'Sent to Accounts'};
 await page.route('**/api/accounts-workspace/material-costing',r=>r.fulfill({json:{rows:[{key:'ubl:7',jobKey:'ubl:7',siteName:'Specific Site',ipo:'CHP-302',customer:'UBL',status:'Ready for PT entry',report:record,documents:[{id:'specific-file',kind:'VSO',filename:'Specific-site-VSO.pdf',downloadUrl:'/api/specific-site-original'}]}]}}));
 await page.route('**/api/inventory-reconciliation/reports/report-site',r=>r.fulfill({json:{versions:[{version:1,stage:'Sent to Accounts',snapshot:{entry:{extra:[]},reconciliation:{sections:[]}}}],files:[{id:'report-file',filename:'Specific-site-attachment.pdf'}]}}));
 let jobsRequests=0;await page.route('**/api/inventory-reconciliation/jobs',r=>{jobsRequests++;return r.fulfill({json:{jobs:[]}});});
 await page.goto('/dashboard#workspace=finance&accountsTab=Inventory+PT+Entries');await page.getByRole('button',{name:'Review material entry',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Specific Site');await expect(dialog.getByRole('button',{name:'VSO',exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Specific-site-attachment.pdf',exact:true})).toBeVisible();
 const pdf=new jsPDF({compress:true});pdf.text('Fictional signed VSO preview',20,20);let downloads=0;page.on('download',()=>downloads++);await page.route('**/api/specific-site-original',r=>r.fulfill({contentType:'application/pdf',body:Buffer.from(pdf.output('arraybuffer'))}));await dialog.getByRole('button',{name:'VSO',exact:true}).click();await expect(dialog.getByRole('img',{name:'VSO · page 1',exact:true})).toBeVisible();expect(downloads).toBe(0);expect(jobsRequests).toBe(0);await expect(page.getByRole('heading',{name:'Receipts & Reconciliation',exact:true})).toHaveCount(0);
});
