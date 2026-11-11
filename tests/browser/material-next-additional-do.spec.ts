import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';

// After a first partial DO, the Materials page asks only for what goes on the next DO, lists every DO of the
// project with its own items, and makes an Additional DO for extra material. Server replies are simulated.
test('next delivery and Additional DO are new DOs; the page enters only "send now" quantities',async({page})=>{
 await actors(page.request);await login(page.request);
 const id='11111111-1111-4111-8111-111111111111',fixedDraft='22222222-2222-4222-8222-222222222222',variableDraft='66666666-6666-4666-8666-666666666666',siteId='33333333-3333-4333-8333-333333333333';
 const vpdKey='44444444-4444-4444-8444-444444444444',cableKey='77777777-7777-4777-8777-777777777777';
 const source={sourceKind:'store-boq',basisId:fixedDraft,basisVersion:1,siteId,siteName:'Isolated partial site',ipo:'SIM-PARTIAL',customer:'UBL',installation:true,items:[{key:'CH-VPD-63A/2P',description:'VPD 2P',qty:'4',unit:'piece'}]};
 const transport={issuedTo:'Fixture team',vehicle:'Fixture vehicle',driver:'Fixture driver',driverIdentity:''};
 const vpd={key:vpdKey,itemId:'CH-VPD-63A/2P',description:'VPD 2P',unit:'piece',out:'2',sites:[siteId],fixedGroup:'other',basisLine:0};
 const cable={key:cableKey,itemId:'CH-CBL-AC-16MM/4C-PK',description:'AC cable 16mm 4 core',unit:'m',out:'10',sites:[siteId],section:'customer',documentPolicyVersion:2};
 const plan=(version:number)=>({id,version,variableSupply:'single-site',fixed:{id:fixedDraft,version,snapshot:{kind:'fixed',parent:false,warehouse:'Lahore warehouse',sites:[source],lines:[vpd],transport}},variable:{id:variableDraft,version,snapshot:{kind:'variable',parent:false,warehouse:'Lahore warehouse',sites:[source],lines:[cable],transport}}});
 const dos=[{id:'d1',number:'SIM-DO-1',createdAt:'2026-11-09T05:00:00Z',partialDelivery:true,additional:false,variable:true,lines:[{key:vpdKey,itemId:vpd.itemId,unit:'piece',quantity:'2'},{key:cableKey,itemId:cable.itemId,unit:'m',quantity:'10'}]}];
 const saves:any[]=[],issues:any[]=[],sent={vpd:2,cable:10};
 await page.route('**/api/material-dispatches/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname.replace('/api/material-dispatches',''),method=route.request().method();
  if(path==='/access')return route.fulfill({json:{kind:'management'}});
  if(path==='/intake')return route.fulfill({json:{sources:[source],catalogue:[{itemId:vpd.itemId,description:vpd.description,units:['piece']},{itemId:cable.itemId,description:cable.description,units:['m']}],warehouses:['Lahore warehouse']}});
  if(path==='/site-plans/'+id&&method==='GET')return route.fulfill({json:plan(1)});
  if(path==='/site-plans'&&method==='POST'){const body=route.request().postDataJSON();saves.push(body);return route.fulfill({json:{id,version:saves.length+1}});}
  if(path==='/site-plans/'+id+'/issue'){const body=route.request().postDataJSON();issues.push(body);const n=dos.length+1,last=saves.at(-1);
   // Like the server: the new DO holds the saved totals minus everything sent before.
   const vpdNow=Number(last.fixedLines[0].out)-sent.vpd,cableNow=Number(last.variableLines[0].out)-sent.cable;sent.vpd+=vpdNow;sent.cable+=cableNow;
   dos.push({id:'d'+n,number:'SIM-DO-'+n,createdAt:'2026-11-1'+n+'T05:00:00Z',partialDelivery:!!body.partialDelivery,additional:!!body.additional,variable:true,lines:[{key:vpdKey,itemId:vpd.itemId,unit:'piece',quantity:String(vpdNow)},{key:cableKey,itemId:cable.itemId,unit:'m',quantity:String(cableNow)}].filter(l=>Number(l.quantity)>0)});
   return route.fulfill({json:{id:'d'+n,number:'SIM-DO-'+n}});}
  if(path==='/site-plans/'+id+'/issued')return route.fulfill({json:{dispatches:[...dos].reverse()}});
  if(path==='/stock')return route.fulfill({json:{authority:{state:'active',source_sha256:'a'.repeat(64),version:1},positions:[{itemId:vpd.itemId,unit:'piece',currentClosing:'10',ledgerRevision:0},{itemId:cable.itemId,unit:'m',currentClosing:'500',ledgerRevision:0}]}});
  if(path==='/transport-choices')return route.fulfill({json:{choices:[]}});
  if(/\/issued\/d\d+\/(document|customer-signoff)\.pdf$/.test(path))return route.fulfill({json:{kind:'fixed-do',status:'prepared',title:'Delivery Order',reference:'SIM',warehouse:'Lahore warehouse',sites:[{name:source.siteName,ipo:source.ipo,customer:'UBL'}],rows:[],signatures:[],stockPosting:false}});
  return route.fulfill({json:{versions:[],files:[],dispatches:[],receipts:[],lines:[]}});
 });
 await page.goto('/inventory/materials/'+id);
 const list=page.getByRole('region',{name:'DOs for this project'});
 await expect(list).toContainText('SIM-DO-1');await expect(list).toContainText('Partial delivery');await expect(list).toContainText('CH-VPD-63A/2P 2 piece');
 const vpdBox=page.getByLabel('Issued quantity CH-VPD-63A/2P',{exact:true}),cableBox=page.getByLabel('Issued quantity CH-CBL-AC-16MM/4C-PK',{exact:true});
 await expect(vpdBox).toHaveValue('');await expect(cableBox).toHaveValue('');
 const saveDo=async()=>{await page.getByRole('button',{name:'Preview & Save DO',exact:true}).click();const review=page.getByRole('dialog',{name:'Review DO before saving'});await expect(review).toContainText('Existing DOs remain unchanged.');await review.getByRole('button',{name:'Save DO',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'saved as a new DO'})).toBeVisible();await page.keyboard.press('Escape');};
 // Next delivery: 2 more VPDs. The saved total is 4; the new DO is not marked additional.
 await vpdBox.fill('2');await page.getByRole('checkbox',{name:/Partial delivery/}).check();await saveDo();
 expect(saves[0].fixedLines[0].out).toBe('4');expect(saves[0].variableLines[0].out).toBe('10');expect(saves[0].revisionReason).toBe('Next delivery');
 expect(issues[0].additional).toBeUndefined();expect(issues[0].partialDelivery).toBe(true);
 await expect(list).toContainText('SIM-DO-2');await expect(list).toContainText('SIM-DO-1');
 // Additional DO: needs a reason, then 100 m extra cable goes on its own DO.
 await page.getByRole('button',{name:'Additional DO (extra material)',exact:true}).click();
 await expect(page.getByRole('checkbox',{name:/Partial delivery/})).toHaveCount(0);
 await cableBox.fill('100');await page.getByRole('button',{name:'Preview & Save DO',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Write why the extra material is needed');
 await page.getByLabel('Why is the extra material needed? (required)').fill('Customer needs 100 m more cable');await saveDo();
 expect(saves[1].variableLines[0].out).toBe('110');expect(saves[1].fixedLines[0].out).toBe('4');expect(saves[1].revisionReason).toBe('Customer needs 100 m more cable');
 expect(issues[1].additional).toBe(true);expect(issues[1].partialDelivery).toBe(false);expect(issues[1].note).toBe('Customer needs 100 m more cable');
 await expect(list).toContainText('Additional (extra material)');await expect(list).toContainText('CH-CBL-AC-16MM/4C-PK 100 m');await expect(list).toContainText('DOs for this project · 3');
});
