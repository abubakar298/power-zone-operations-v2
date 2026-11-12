import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
// The Edit this DO preview shows unsaved numbers. It must say so on every page and offer
// no Print/Download, so nobody keeps it as if it were the saved DO.
test('Edit this DO preview is marked not saved and cannot be downloaded',async({page})=>{
 await actors(page.request);await login(page.request);
 const id='00000000-0000-4000-8000-000000000022',line={key:'00000000-0000-4000-8000-0000000000aa',itemId:'CH-CBL-DC-6MM/1C-R/PK',description:'6mm 1-core DC cable Red',unit:'m',out:'150'};
 const transport={issuedTo:'Site',vehicle:'KS 3166',driver:'Rehan',driverIdentity:''};
 const model={kind:'fixed-do',status:'prepared',title:'Fixed Material Delivery Order',reference:'CPZ-DO-26-0022',warehouse:'Karachi warehouse',sites:[{name:'Rehmania Mor, Karachi',ipo:'CHP-354',customer:'United Bank Limited'}],rows:[{itemId:line.itemId,description:line.description,unit:'m',issued:'150',used:null,returned:null,group:'Fixed'}],issuedLabel:'Issued',signatures:[],stockPosting:false,date:'2026-11-03',transport};
 await page.route('**/api/material-dispatches/access',r=>r.fulfill({json:{kind:'dispatcher'}}));
 await page.route('**/api/material-dispatches/gate-passes',r=>r.fulfill({json:{kind:'dispatcher',warehouses:['Karachi warehouse'],records:[{kind:'dispatch',id,number:'CPZ-DO-26-0022',warehouse:'Karachi warehouse',created_at:'2026-11-03T10:00:00Z',signed_copies:0}],signoffs:[]}}));
 await page.route(`**/api/material-dispatches/gate-passes/dispatch/${id}/document.pdf*`,r=>r.fulfill({json:model}));
 await page.route(`**/api/material-dispatches/issued/${id}/edit`,r=>r.fulfill({json:{number:'CPZ-DO-26-0022',revision:1,editable:true,cancelled:false,warehouse:'Karachi warehouse',snapshot:{lines:[line],transport},model,catalogue:[{itemId:line.itemId,description:line.description,units:['m']}],history:[]}}));
 let saves=0;await page.route(`**/api/material-dispatches/issued/${id}/revise`,r=>{saves++;return r.fulfill({json:{}});});
 await page.goto('/inventory/gate-passes');
 await page.locator('article',{hasText:'CPZ-DO-26-0022'}).getByRole('button',{name:/Download DO|Preview|Download/}).first().click();
 const dialog=page.getByRole('dialog');
 // The saved DO itself can still be printed and downloaded.
 await expect(dialog.getByRole('button',{name:'Download PDF',exact:true}).first()).toBeEnabled();
 await dialog.getByRole('button',{name:'Edit this DO'}).click();
 const qty=dialog.locator('input[value="150"]');await qty.fill('145');
 await dialog.getByRole('button',{name:'Preview revised DO'}).click();
 const review=dialog.getByRole('region',{name:'Review revised DO'});
 await expect(review).toContainText('Preview – not saved.');
 await expect(review.locator('.issue-print-sheet').first()).toContainText('PREVIEW – NOT SAVED');
 await expect(review.getByRole('button',{name:'Download PDF',exact:true})).toHaveCount(0);
 await expect(review.getByRole('button',{name:'Print',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Save changes to same DO'})).toBeVisible();
 expect(saves).toBe(0);
 await page.screenshot({path:'test-results/do-edit-preview-unsaved.png',fullPage:true});
});
