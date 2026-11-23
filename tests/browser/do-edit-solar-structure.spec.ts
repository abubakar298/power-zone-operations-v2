import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
// Shaiggan's case (23 Nov 2026): the structure was left off a DO, so he adds it to that same DO
// with "Edit this DO". It is vendor-bought: quantity always 1, size chosen in kW.
test('Edit this DO adds CH-Solar Structure with a chosen kW and shows it in the preview',async({page})=>{
 await actors(page.request);await login(page.request);
 const id='00000000-0000-4000-8000-000000000044',line={key:'00000000-0000-4000-8000-0000000000bb',itemId:'CH-BAT-HV-05 KW',description:'HV battery',unit:'Nos',out:'1'};
 const transport={issuedTo:'Site',vehicle:'MN 1044',driver:'Driver',driverIdentity:''};
 const model={kind:'fixed-do',status:'prepared',title:'Fixed Material Delivery Order',reference:'CPZ-DO-26-0044',warehouse:'Lahore warehouse',sites:[{name:'Fixture site, Multan',ipo:'IPO-44',customer:'Fixture customer'}],rows:[{itemId:line.itemId,description:line.description,unit:'Nos',issued:'1',used:null,returned:null,group:'Fixed'}],issuedLabel:'Issued',signatures:[],stockPosting:false,date:'2026-11-22',transport};
 await page.route('**/api/material-dispatches/access',r=>r.fulfill({json:{kind:'dispatcher'}}));
 await page.route('**/api/material-dispatches/gate-passes',r=>r.fulfill({json:{kind:'dispatcher',warehouses:['Lahore warehouse'],records:[{kind:'dispatch',id,number:'CPZ-DO-26-0044',warehouse:'Lahore warehouse',created_at:'2026-11-22T11:07:49Z',signed_copies:0}],signoffs:[]}}));
 await page.route(`**/api/material-dispatches/gate-passes/dispatch/${id}/document.pdf*`,r=>r.fulfill({json:model}));
 await page.route(`**/api/material-dispatches/issued/${id}/edit`,r=>r.fulfill({json:{number:'CPZ-DO-26-0044',revision:1,editable:true,cancelled:false,warehouse:'Lahore warehouse',snapshot:{lines:[line],transport},model,catalogue:[{itemId:line.itemId,description:line.description,units:['Nos']},{itemId:'CH-Solar Structure',description:'Solar structure',units:['No.']}],history:[]}}));
 let sent:any;await page.route(`**/api/material-dispatches/issued/${id}/revise`,r=>{sent=r.request().postDataJSON();return r.fulfill({json:{}});});
 await page.goto('/inventory/gate-passes');
 await page.locator('article',{hasText:'CPZ-DO-26-0044'}).getByRole('button',{name:/Download DO|Preview|Download/}).first().click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('button',{name:'Edit this DO'}).click();
 await dialog.getByRole('button',{name:'＋ Add item'}).click();
 await dialog.getByRole('combobox',{name:'DO item 2',exact:true}).selectOption('CH-Solar Structure');
 await expect(dialog.getByLabel('DO quantity 2',{exact:true})).toHaveText('1');
 const preview=dialog.getByRole('button',{name:'Preview revised DO'});
 await expect(preview).toBeDisabled();
 await dialog.getByRole('combobox',{name:'Solar structure size 2',exact:true}).selectOption('4');
 await preview.click();
 const review=dialog.getByRole('region',{name:'Review revised DO'});
 await expect(review.locator('.issue-print-sheet').first()).toContainText('Solar structure — 4 kW');
 await dialog.getByLabel('Reason for change').fill('Add the solar structure left off this DO');
 await dialog.getByRole('button',{name:'Save changes to same DO'}).click();
 await expect.poll(()=>sent?.lines?.find((l:any)=>l.itemId==='CH-Solar Structure')).toMatchObject({itemId:'CH-Solar Structure',unit:'No.',out:'1',description:'Solar structure — 4 kW'});
 expect(sent.lines.find((l:any)=>l.itemId==='CH-BAT-HV-05 KW')).toEqual({key:line.key,itemId:line.itemId,unit:'Nos',out:'1'});
});
