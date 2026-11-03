import {readFile} from 'node:fs/promises';
import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
for(const parent of [false,true])test((parent?'Parent DO':'Individual DO')+' downloads every copy as A4 even when the rendered content is taller than the printable area',async({page})=>{
 await actors(page.request);await login(page.request);
 const id='11111111-1111-4111-8111-111111111111',draftId='22222222-2222-4222-8222-222222222222',siteId='33333333-3333-4333-8333-333333333333',key='44444444-4444-4444-8444-444444444444',dispatchId='55555555-5555-4555-8555-555555555555';
 const source={sourceKind:'store-boq',basisId:draftId,basisVersion:1,siteId,siteName:'Isolated UPS site',ipo:'SIM-UPS',customer:'UBL',installation:true,items:[{key:'CH-VPD-63A/2P',description:'VPD 2P',qty:'1',unit:'piece'}]};
 const line={key,itemId:'CH-VPD-63A/2P',description:'VPD 2P',unit:'piece',out:'1',sites:[siteId],fixedGroup:'other',basisLine:0};
 const fixed={id:draftId,version:1,snapshot:{kind:'fixed',parent:false,warehouse:'Lahore warehouse',sites:[source],lines:[line],transport:{issuedTo:'Fixture team',vehicle:'Fixture vehicle',driver:'Fixture driver',driverIdentity:''}}};
 const plan={id,version:1,variableSupply:'parent-do',fixed,variable:null};let created=0,uploads=0;
 await page.route('**/api/material-dispatches/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname.replace('/api/material-dispatches','');
  if(path==='/access')return route.fulfill({json:{kind:'management'}});
  if(path==='/intake')return route.fulfill({json:{sources:[source],catalogue:[{itemId:line.itemId,description:line.description,units:['piece']}],warehouses:['Lahore warehouse']}});
  if(path==='/site-plans/'+id)return route.fulfill({json:plan});
  if(path==='/stock')return route.fulfill({json:{authority:{state:'active',source_sha256:'a'.repeat(64),version:1},positions:[{itemId:line.itemId,unit:'piece',currentClosing:'10',ledgerRevision:0}]}});
  if(path==='/transport-choices')return route.fulfill({json:{choices:[]}});
  if(path==='/site-plans/'+id+'/issued')return route.fulfill({json:{dispatches:created?[{id:dispatchId,number:'SIM-DO-1',variable:false,lines:[{key,quantity:'1'}]}]:[]}});
  if(path==='/drafts/'+draftId+'/movements')return route.fulfill({json:{dispatches:created?[{id:dispatchId,number:'SIM-DO-1',created_at:'2026-10-29',stockPosted:false}]:[],receipts:[],lines:[{line_key:key,prepared:created?'1':'0',issued:'0',returned:'0',outstanding:'0'}]}});
  if(path==='/site-plans/'+id+'/issue'){created++;expect(route.request().postDataJSON().version).toBe(1);return route.fulfill({json:{id:dispatchId,number:'SIM-DO-1'}});}
  if(path==='/issued/'+dispatchId+'/customer-signoff.pdf')return route.fulfill({json:{kind:'customer-signoff',status:'prepared',title:'Variable-Material Usage Sign-off',reference:'SIM-DO-1',warehouse:'Lahore warehouse',sites:[{name:source.siteName,ipo:source.ipo,customer:'UBL'}],rows:[],blankRows:5,signatures:[],stockPosting:false}});
  if(path==='/issued/'+dispatchId+'/document.pdf')return route.fulfill({json:{kind:'fixed-do',status:'issued',title:'Delivery Order',reference:'SIM-DO-1',warehouse:'Lahore warehouse',parentDispatch:parent,sites:parent?Array.from({length:10},(_,i)=>({name:'Multan route site '+(i+1)+' with a long branch name and delivery address',ipo:'SIM-'+i,customer:'UBL'})):[{name:source.siteName,ipo:source.ipo,customer:'UBL'}],rows:[{itemId:line.itemId,description:line.description,unit:'piece',issued:'1',used:null,returned:null}],signatures:[],stockPosting:false}});
  if(route.request().method()==='POST')uploads++;
  return route.fulfill({json:{versions:[],files:[]}});
 });
 await page.goto('/inventory/materials/'+id);
 const create=page.getByRole('button',{name:'Preview & Save DO',exact:true});await expect(create).toBeEnabled();
 await expect(page.locator('.material-plan-actions').getByRole('button',{name:'Site use & reconciliation'})).toHaveCount(0);
 await create.click();const review=page.getByRole('dialog',{name:'Review DO before saving'});await expect(review.locator('.issue-print-sheet')).toHaveCount(4);await review.getByRole('button',{name:'Save DO',exact:true}).click();const dialog=page.getByRole('dialog');
 await expect(dialog.locator('.issue-print-sheet')).toHaveCount(parent?2:4);await expect(dialog.getByRole('button',{name:'Print',exact:true})).toBeEnabled();await expect(dialog.getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled();
 const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download PDF',exact:true}).click();const download=await pending;expect(await download.failure()).toBeNull();const bytes=await readFile((await download.path())!);const boxes=[...bytes.toString('latin1').matchAll(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/g)];expect(boxes).toHaveLength(parent?2:4);for(const box of boxes){expect(Number(box[1])).toBeCloseTo(595.28,1);expect(Number(box[2])).toBeCloseTo(841.89,1);}expect(bytes.length).toBeLessThan(2*1024*1024);await expect(dialog.getByRole('alert')).toHaveCount(0);
 await dialog.getByRole('combobox').selectOption(dispatchId+':signoff');await expect(dialog.locator('.issue-print-sheet')).toHaveCount(1);await expect(dialog.locator('.issue-do-handwritten-row')).toHaveCount(5);
 expect(created).toBe(1);expect(uploads).toBe(0);await expect(page.getByRole('status')).toContainText('Signed gate evidence records the warehouse dispatch.');
});
