import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
// Owner rule: a site DO lists fixed items only; its variable items print on a
// separate Variable Material Gate Pass (same DO number, gate and storekeeper copies).
test('Preview & Save DO keeps cable off the DO copies and shows it on the Variable Material Gate Pass',async({page})=>{
 await actors(page.request);await login(page.request);
 const id='11111111-1111-4111-8111-111111111111',draftId='22222222-2222-4222-8222-222222222222',variableId='66666666-6666-4666-8666-666666666666',siteId='33333333-3333-4333-8333-333333333333';
 const source={sourceKind:'store-boq',basisId:draftId,basisVersion:1,siteId,siteName:'Fixture solar site',ipo:'SIM-SOLAR',customer:'Fixture customer',installation:true,items:[{key:'CH-VPD-63A/2P',description:'VPD 2P',qty:'1',unit:'piece'}]};
 const fixedLine={key:'44444444-4444-4444-8444-444444444444',itemId:'CH-VPD-63A/2P',description:'VPD 2P',unit:'piece',out:'1',sites:[siteId],fixedGroup:'other',basisLine:0};
 const cable={key:'77777777-7777-4777-8777-777777777777',itemId:'CH-CBL-16MM-AC',description:'16mm2 AC cable',unit:'m',out:'40',sites:[siteId],section:'customer',documentPolicyVersion:2};
 const transport={issuedTo:'Fixture team',vehicle:'Fixture vehicle',driver:'Fixture driver',driverIdentity:''};
 const plan={id,version:1,variableSupply:'single-site',fixed:{id:draftId,version:1,snapshot:{kind:'fixed',parent:false,warehouse:'Lahore warehouse',sites:[source],lines:[fixedLine],transport}},variable:{id:variableId,version:1,snapshot:{kind:'variable',parent:false,warehouse:'Lahore warehouse',sites:[source],lines:[cable],transport}}};
 await page.route('**/api/material-dispatches/**',async route=>{
  const path=new URL(route.request().url()).pathname.replace('/api/material-dispatches','');
  if(path==='/access')return route.fulfill({json:{kind:'management'}});
  if(path==='/intake')return route.fulfill({json:{sources:[source],catalogue:[{itemId:fixedLine.itemId,description:fixedLine.description,units:['piece']},{itemId:cable.itemId,description:cable.description,units:['m']}],warehouses:['Lahore warehouse']}});
  if(path==='/site-plans/'+id)return route.fulfill({json:plan});
  if(path==='/stock')return route.fulfill({json:{authority:{state:'active',source_sha256:'a'.repeat(64),version:1},positions:[{itemId:fixedLine.itemId,unit:'piece',currentClosing:'10',ledgerRevision:0},{itemId:cable.itemId,unit:'m',currentClosing:'500',ledgerRevision:0}]}});
  if(path==='/transport-choices')return route.fulfill({json:{choices:[]}});
  if(path==='/site-plans/'+id+'/issued')return route.fulfill({json:{dispatches:[]}});
  if(path==='/drafts/'+draftId+'/movements'||path==='/drafts/'+variableId+'/movements')return route.fulfill({json:{dispatches:[],receipts:[],lines:[]}});
  return route.fulfill({json:{versions:[],files:[]}});
 });
 await page.goto('/inventory/materials/'+id);
 await page.getByRole('button',{name:'Preview & Save DO',exact:true}).click();
 const review=page.getByRole('dialog',{name:'Review DO before saving'});
 const sheets=review.locator('.issue-print-sheet');
 const doSheets=sheets.filter({hasText:'Delivery Order / Outwards Gate Pass'}),gateSheets=sheets.filter({hasText:'Variable Material Gate Pass'});
 await expect(doSheets).toHaveCount(4);
 for(const sheet of await doSheets.all()){await expect(sheet).toContainText('VPD 2P');await expect(sheet).not.toContainText('16mm2 AC cable');}
 await expect(gateSheets).toHaveCount(2);
 await expect(gateSheets.nth(0)).toContainText('Gate copy');await expect(gateSheets.nth(1)).toContainText('Storekeeper copy');
 for(const sheet of await gateSheets.all()){await expect(sheet).toContainText('16mm2 AC cable');await expect(sheet).not.toContainText('VPD 2P');}
 // The VSO still lists the cable for the customer.
 await expect(sheets.filter({hasText:'Variable-Material Usage Sign-off'}).first()).toContainText('16mm2 AC cable');
});
