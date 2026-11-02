import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
test('mixed issuance details remain editable for first and duplicate item rows and reach the saved DO',async({page})=>{
 await actors(page.request);await login(page.request);
 const id='11111111-1111-4111-8111-111111111111',draftId='22222222-2222-4222-8222-222222222222',siteId='33333333-3333-4333-8333-333333333333';
 const source={sourceKind:'store-boq',basisId:draftId,basisVersion:1,siteId,siteName:'Mixed material test site',ipo:'SIM-UPS',customer:'UBL',installation:true,items:[]};
 const lines=['44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555'].map(key=>({key,itemId:'CH-Mix Items All',description:'Mixed accessories',unit:'piece',out:'1',sites:[siteId],section:'internal',documentPolicyVersion:2}));
 lines.push({...lines[0],key:'77777777-7777-4777-8777-777777777777',itemId:'CH-Pvc Pipe 1.5 Inch',description:'PVC Pipe 1.5 Inch'});
 const fixedLines=['Roof DC breaker','Inverter room DC breaker'].map((description,index)=>({key:'66666666-6666-4666-8666-66666666666'+index,itemId:'CH-BRK-DC-20A/4P',description,unit:'piece',out:'4',sites:[siteId],fixedGroup:'bess'}));
 const transport={issuedTo:'Fixture team',vehicle:'Fixture vehicle',driver:'Fixture driver',driverIdentity:''};let saved:any;
 await page.route('**/api/material-dispatches/**',async route=>{
  const path=new URL(route.request().url()).pathname.replace('/api/material-dispatches','');
  if(path==='/access')return route.fulfill({json:{kind:'management'}});
  if(path==='/intake')return route.fulfill({json:{sources:[source],catalogue:[{itemId:'CH-Mix Items All',description:'Mixed accessories',units:['piece']}],warehouses:['Lahore warehouse']}});
  if(path==='/site-plans/'+id)return route.fulfill({json:{id,version:1,variableSupply:'single-site',fixed:{id:draftId,version:1,snapshot:{kind:'fixed',parent:false,warehouse:'Lahore warehouse',sites:[source],lines:fixedLines,transport}},variable:{snapshot:{lines}}}});
  if(path==='/stock')return route.fulfill({json:{positions:[]}});
  if(path==='/transport-choices')return route.fulfill({json:{choices:[]}});
  if(path==='/site-plans/'+id+'/issued')return route.fulfill({json:{dispatches:[]}});
  if(path==='/drafts/'+draftId+'/movements')return route.fulfill({json:{dispatches:[],receipts:[],lines:[]}});
  if(path==='/site-plans'&&route.request().method()==='POST'){saved=route.request().postDataJSON();return route.fulfill({json:{id,version:2}});}
  if(path==='/site-plans/'+id+'/issue')return route.fulfill({json:{id:draftId,number:'SIM-DO-1'}});
  return route.fulfill({json:{versions:[],files:[]}});
 });
 await page.goto('/inventory/materials/'+id);
 await expect(page.getByRole('region',{name:'Fixed material issuance',exact:true}).getByRole('columnheader',{name:'DC Switchgear',exact:true})).toBeVisible();
 const fixedRows=await page.getByRole('region',{name:'Fixed material issuance',exact:true}).getByRole('row').allTextContents();const dc=fixedRows.findIndex(r=>r==='DC Switchgear');expect(dc).toBeGreaterThan(0);expect(fixedRows[dc+1]).toContain('Roof DC breaker');expect(fixedRows[dc+2]).toContain('Inverter room DC breaker');
 const first=page.getByRole('textbox',{name:'Material details CH-Mix Items All',exact:true}).first();await expect(first).toBeEditable();await first.fill('Lugs 16mm, screws and tape');
 const duplicate=page.getByRole('textbox',{name:'Material details CH-Mix Items All',exact:true}).nth(1);await duplicate.fill('Clamps and sleeves');
 await expect(first).toHaveValue('Lugs 16mm, screws and tape');
 await page.getByRole('button',{name:'Preview & Save DO',exact:true}).click();const review=page.getByRole('dialog',{name:'Review DO before saving'});await expect(review).toContainText('Lugs 16mm, screws and tape');await expect(review).toContainText('Clamps and sleeves');await review.getByRole('button',{name:'Save DO',exact:true}).click();
 await expect.poll(()=>saved?.variableLines?.map((r:any)=>r.description)).toEqual(['Lugs 16mm, screws and tape','Clamps and sleeves','PVC Pipe 1.5 Inch']);expect(saved.variableLines.map((r:any)=>r.itemId)).toEqual(['CH-Mix Items All','CH-Mix Items All','CH-Pvc Pipe 1.5 Inch']);expect(saved.variableLines.map((r:any)=>r.out)).toEqual(['1','1','1']);expect(saved.variableLines.map((r:any)=>r.section)).toEqual(['internal','internal','customer']);
});
