import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
test('saved site preparation has a clear DO action, auto-opens four copies and never uploads a signed copy',async({page})=>{
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
  if(path==='/drafts/'+draftId+'/movements')return route.fulfill({json:{dispatches:created?[{id:dispatchId,number:'SIM-DO-1',created_at:'2026-10-29',stockPosted:false}]:[],receipts:[],lines:[{line_key:key,prepared:created?'1':'0',issued:'0',returned:'0',outstanding:'0'}]}});
  if(path==='/issues'){created++;expect(route.request().postDataJSON().lines).toEqual([{lineKey:key,quantity:'1',ledgerRevision:0}]);return route.fulfill({json:{id:dispatchId,number:'SIM-DO-1'}});}
  if(path==='/issued/'+dispatchId+'/document.pdf')return route.fulfill({json:{kind:'fixed-do',status:'issued',title:'Delivery Order',reference:'SIM-DO-1',warehouse:'Lahore warehouse',sites:[{name:source.siteName,ipo:source.ipo,customer:'UBL'}],rows:[{itemId:line.itemId,description:line.description,unit:'piece',issued:'1',used:null,returned:null}],signatures:[],stockPosting:false}});
  if(route.request().method()==='POST')uploads++;
  return route.fulfill({json:{versions:[],files:[]}});
 });
 await page.goto('/inventory/materials/'+id);
 const create=page.getByRole('button',{name:'Create DO & print 4 copies',exact:true});await expect(create).toBeEnabled();
 await expect(page.locator('.material-plan-actions').getByRole('button',{name:'Site use & reconciliation'})).toHaveCount(0);
 await create.click();const dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:'Issue CH-VPD-63A/2P',exact:true}).fill('1');await dialog.getByLabel('Dispatch note').fill('Isolated dispatch for printing');await dialog.getByRole('button',{name:'Create DO',exact:true}).click();
 await expect(dialog.locator('.issue-print-sheet')).toHaveCount(4);await expect(dialog.getByRole('button',{name:'Print',exact:true})).toBeEnabled();await expect(dialog.getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled();
 expect(created).toBe(1);expect(uploads).toBe(0);await expect(dialog.getByText('Awaiting signed gate copy · stock unchanged',{exact:true})).toBeVisible();
});
