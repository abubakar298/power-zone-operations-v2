import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
test('scheduled batches are visible before Parent DO selection and each approved site opens its own materials',async({page})=>{
 await actors(page.request);await login(page.request);
 const site='11111111-1111-4111-8111-111111111111',saved='22222222-2222-4222-8222-222222222222';let writes=0;
 await page.route('**/api/material-dispatches/**',async r=>{
  const path=new URL(r.request().url()).pathname.replace('/api/material-dispatches','');if(r.request().method()==='POST')writes++;
  if(path==='/access')return r.fulfill({json:{kind:'management'}});
  if(path==='/intake')return r.fulfill({json:{sources:[],registeredPending:[],catalogue:[],warehouses:['Lahore warehouse'],operationsBatches:[{id:'batch',number:'OPB-TEST',version:2,team:'central',vehicle:'Test vehicle',driver:'Test driver',stops:[{boardSiteId:'board-one',siteId:site,name:'Approved UPS site',ipo:'IPO-TEST',date:'2026-11-01',work:'both',status:'ready'},{boardSiteId:'board-held',name:'Held site',ipo:'IPO-HELD',date:'2026-11-01',work:'delivery',status:'approved-boq-required'}]}]}});
  if(path==='/site-plans')return r.fulfill({json:{plans:[{id:saved,siteId:site}]}});
  return r.fulfill({json:{drafts:[]}});
 });
 await page.goto('/inventory/materials');const batches=page.locator('.parent-operations-batches');await expect(batches).toBeVisible();await expect(batches.locator('summary')).toHaveText('Scheduled Operations batches');
 const held=batches.getByRole('row').filter({hasText:'Held site'});await expect(held).toContainText('Approved BOQ link required');await expect(held.getByRole('button',{name:'Open materials',exact:true})).toHaveCount(0);
 await batches.getByRole('row').filter({hasText:'Approved UPS site'}).getByRole('button',{name:'Open materials',exact:true}).click();await expect(page).toHaveURL(new RegExp('/inventory/materials/'+saved+'$'));expect(writes).toBe(0);
});
