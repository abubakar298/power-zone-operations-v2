import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
import {openWorkspaceSection,openBoqSection,chooseBrand,beginBoq} from './navigation.js';
for(const quick of [false,true])test(`Coordinator ${quick?'Quick BOQ':'measured survey'} prepares the current quotation and preserves it through IPO preview`,async({page})=>{
 page.on('dialog',async d=>{if(['confirm','beforeunload'].includes(d.type()))await d.accept();});
 await actors(page.request);const headers=await login(page.request,'coordinator-release@example.test');
 await page.goto('/dashboard');await expect(page.getByRole('heading',{name:'Current sites',exact:true})).toBeVisible();
 for(const route of ['/api/accounts','/api/backups','/api/departments/Accounts','/api/departments/Inventory'])expect((await page.request.get(route)).status()).toBe(403);
 await openWorkspaceSection(page,'Survey & BOQ');await beginBoq(page,quick);
 await page.getByLabel('Customer',{exact:true}).fill('Alfalah');await page.getByRole('option',{name:/Alfalah/}).click();await page.getByLabel('New site name',{exact:true}).fill('Release '+(quick?'quick':'survey')+' 90901');await page.getByLabel('Site code',{exact:true}).fill(quick?'QUICK909':'SURV909');await page.getByLabel('Location',{exact:true}).fill('Lahore');
 await openBoqSection(page,2);await page.getByLabel('Panel quantity',{exact:true}).fill('60');await page.getByLabel('Panel wattage (W)',{exact:true}).fill('645');await page.getByLabel('BESS configuration',{exact:true}).selectOption('BESS-30-40');await page.getByLabel('Structure',{exact:true}).selectOption('Elevated');
 if(!quick)for(const [field,value]of [['6mm² DC cable total (m)','360'],['2.5mm² earth cable (m)','20'],['6mm² earth cable (m)','90'],['10mm² earth cable (m)','90']])await page.getByLabel(field,{exact:true}).fill(value);
 for(const [field,label]of [['Solar Panel brand','Any of the Above'],['Inverter brand','Chint Power'],['Battery & BMS brand','Chint Power'],['Cable brand','Newage Cables'],['Switchgear brand','CHINT']])await chooseBrand(page,field,label);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.setViewportSize({width:1280,height:900});
 const savedBoq=page.waitForResponse(r=>r.url().endsWith('/api/boqs/save')&&r.request().method()==='POST');await page.getByRole('button',{name:'Enter Pricing',exact:true}).click();const boqResponse=await savedBoq;expect(boqResponse.ok(),await boqResponse.text()).toBe(true);const boq=await boqResponse.json();
 const discountControl=page.getByRole('checkbox',{name:'Add discount to selling price',exact:true});
 await expect(discountControl).toBeVisible();await expect(discountControl).not.toBeChecked();
 await expect(page.getByLabel('Discount (%)',{exact:true})).toBeVisible();
 if(quick)await discountControl.check();
 await expect(page.getByRole('button',{name:'Preview Quotation',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Preview Quotation',exact:true}).click();await expect(page.locator('.quotation-pdf-pages canvas').first()).toBeVisible();
 const savedQuote=page.waitForResponse(r=>r.url().endsWith('/api/commercial/quotations')&&r.request().method()==='POST');await page.getByRole('button',{name:'Approve Quotation',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:/Approve quotation|Save and send|Confirm and send/}).click();const qr=await savedQuote;expect(qr.ok(),await qr.text()).toBe(true);const quote=await qr.json();
 expect(!!quote.snapshot.input.includeDiscountInSellingPrice).toBe(quick);
 if(quick){expect(quote.snapshot.discountPresentation).toBe('included-in-selling-prices');expect(quote.snapshot.footer.some((r:any)=>/Discount/.test(r.label))).toBe(false);}
 expect(quote.boq_revision_id).toBe(boq.id);await expect.poll(async()=>(await(await page.request.get(`/api/commercial/quotations/${quote.id}`)).json()).workflow_status).toBe('Approved');const detail=await(await page.request.get(`/api/commercial/quotations/${quote.id}`)).json();
 const input={quotationId:quote.id,evidenceType:'Verbal sale confirmation',evidenceNotes:'Isolated browser validation only',orderDate:'2026-10-23',invoiceCompany:'PZES',salesPerson:'Release Coordinator',customerAccepted:true};
 const order=await page.request.post('/api/orders/preview',{headers,data:input});expect(order.ok(),await order.text()).toBe(true);const allocation=(await order.json()).snapshot.allocation;
 expect(allocation.total).toBe(detail.snapshot.footer.at(-1).amount);expect(JSON.stringify((await(await page.request.get(`/api/commercial/quotations/${quote.id}`)).json()).snapshot)).toBe(JSON.stringify(detail.snapshot));
});
