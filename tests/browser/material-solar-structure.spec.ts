import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
// Owner instruction 23 Nov 2026: CH-Solar Structure is vendor-bought, so it is offered on the DO
// although no warehouse stock exists; its quantity is always 1 and its size is chosen in kW.
test('Inventory adds CH-Solar Structure to a DO with a fixed quantity of 1 and a chosen kW size',async({page})=>{
 await actors(page.request);await login(page.request);
 const id='11111111-1111-4111-8111-111111111112',draftId='22222222-2222-4222-8222-222222222223',siteId='33333333-3333-4333-8333-333333333334';
 const source={sourceKind:'store-boq',basisId:draftId,basisVersion:1,siteId,siteName:'Solar structure test site',ipo:'SIM-SOLAR',customer:'Fixture customer',installation:true,items:[]};
 const fixedLines=[{key:'66666666-6666-4666-8666-666666666661',itemId:'CH-BAT-HV-05 KW',description:'HV battery',unit:'Nos',out:'1',sites:[siteId],fixedGroup:'bess'}];
 const transport={issuedTo:'Fixture team',vehicle:'Fixture vehicle',driver:'Fixture driver',driverIdentity:''};let saved:any;
 await page.route('**/api/material-dispatches/**',async route=>{
  const path=new URL(route.request().url()).pathname.replace('/api/material-dispatches','');
  if(path==='/access')return route.fulfill({json:{kind:'management'}});
  // Warehouse stock only: the structure is not in this list.
  if(path==='/intake')return route.fulfill({json:{sources:[source],catalogue:[{itemId:'CH-BAT-HV-05 KW',description:'HV battery',units:['Nos']}],warehouses:['Lahore warehouse']}});
  if(path==='/site-plans/'+id)return route.fulfill({json:{id,version:1,variableSupply:'single-site',fixed:{id:draftId,version:1,snapshot:{kind:'fixed',parent:false,warehouse:'Lahore warehouse',sites:[source],lines:fixedLines,transport}},variable:{snapshot:{lines:[]}}}});
  if(path==='/stock')return route.fulfill({json:{positions:[]}});
  if(path==='/transport-choices')return route.fulfill({json:{choices:[]}});
  if(path==='/site-plans/'+id+'/issued')return route.fulfill({json:{dispatches:[]}});
  if(path==='/drafts/'+draftId+'/movements')return route.fulfill({json:{dispatches:[],receipts:[],lines:[]}});
  if(path==='/site-plans'&&route.request().method()==='POST'){saved=route.request().postDataJSON();return route.fulfill({json:{id,version:2}});}
  if(path==='/site-plans/'+id+'/issue')return route.fulfill({json:{id:draftId,number:'SIM-DO-1'}});
  return route.fulfill({json:{versions:[],files:[]}});
 });
 await page.goto('/inventory/materials/'+id);
 const fixed=page.getByRole('region',{name:'Fixed material issuance',exact:true});
 await fixed.getByRole('button',{name:'＋ Add item',exact:true}).click();
 await page.getByRole('searchbox',{name:'Search inventory item ID or name',exact:true}).fill('solar structure');
 await page.getByRole('option',{name:/CH-Solar Structure/}).click();
 const size=fixed.getByRole('combobox',{name:/^Solar structure size/});
 await expect(size).toHaveValue('');
 await expect(fixed.getByLabel('Issued quantity CH-Solar Structure',{exact:true})).toHaveText('1');
 await expect(fixed.getByRole('spinbutton',{name:'Issued quantity CH-Solar Structure',exact:true})).toHaveCount(0);
 await size.selectOption('3');
 await expect(fixed).toContainText('Solar structure — 3 kW');
 await page.getByRole('button',{name:'Preview & Save DO',exact:true}).click();const review=page.getByRole('dialog',{name:'Review DO before saving'});await expect(review).toContainText('Solar structure — 3 kW');await review.getByRole('button',{name:'Save DO',exact:true}).click();
 await expect.poll(()=>saved?.fixedLines?.find((r:any)=>r.itemId==='CH-Solar Structure')).toMatchObject({description:'Solar structure — 3 kW',unit:'No.',out:'1',fixedGroup:'panels'});
});
