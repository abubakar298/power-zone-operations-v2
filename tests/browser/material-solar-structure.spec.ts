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

// Shaiggan's case (23 Nov 2026, site Ameen Kothey Wala): DO 0043 already sent every fixed item. He picked the
// structure on one of those sent rows; the row's sent quantity hid the structure (empty Issued Qty, missing from
// the preview). The structure must get its own new row with quantity 1, and the sent row must stay as it was.
test('picking CH-Solar Structure on a row already sent on a DO adds it as its own row with quantity 1',async({page})=>{
 await actors(page.request);await login(page.request);
 const id='11111111-1111-4111-8111-111111111112',draftId='22222222-2222-4222-8222-222222222223',variableId='22222222-2222-4222-8222-222222222224',siteId='33333333-3333-4333-8333-333333333334';
 const B=(key:string,description:string,qty:string,unit:string)=>({key,description,qty,unit});
 const items=[B('Solar PV Modules','Solar panels','20000','W'),B('Structure - Elevated','Elevated structure','20000','W'),B('HYB-3P-020','HYB-3P-020','1','No.'),B('BAT-HV-05 KW WO BMS','HV 5kWh battery','6','No.'),B('CH-BMS-HV','HV BMS','2','No.'),B('DC Breaker','Roof DC breaker','3','No.'),B('DC Breaker','Inverter room DC breaker','3','No.'),B('DC Fuse with Holder','DC fuse with holder','3','No.'),B('DC SPD','DC SPD','3','No.'),B('AC & DC Boxes','AC & DC Boxes combined','1','LS'),B('6mm² DC Cable Red','DC cable red 6mm²','135','MTRS'),B('6mm² DC Cable Black','DC cable black 6mm²','135','MTRS'),B('Misc. Accessories','Misc accessories combined','1','LS'),B('100A 4P MCCB','Grid input 100A 4P MCCB','1','No.'),B('63A 4P MCB','Output 63A 4P MCB','1','No.'),B('AC SPD','AC SPD','1','No.'),B('63A 4P Changeover','63A 4P Changeover','1','No.'),B('16mm² 4C AC Cable','16mm² 4C inverter cable','10','MTRS'),B('16mm² 4C AC Cable','16mm² 4C load cable','20','MTRS'),B('Earthing Bore','UBL earthing bore','2','No.'),B('2.5mm² Earthing Cable','2.5mm² earth panel to panel','15','MTRS'),B('6mm² Earthing Cable','6mm² DC earth','60','MTRS'),B('10mm² Earthing Cable','10mm² AC earth','60','MTRS'),B('Extra Smart Meter','Smart meter included with inverter','1','No.'),B('UBL Genset Synchronisation','UBL genset synchronization','1','JOB'),B('UBL Internet','Router/device plus first month','1','JOB'),B('Electrical labour','Electrical labour','20000','W costing basis'),B('Delivery/logistics','Delivery/logistics','20000','W costing basis')];
 const source={sourceKind:'store-boq',basisId:draftId,basisVersion:1,siteId,siteName:'Ameen Kothey Wala',ipo:'SIM-AMEEN',customer:'United Bank Limited',installation:true,items};
 const k=(n:number)=>'66666666-6666-4666-8666-6666666666'+String(n).padStart(2,'0');
 const fixedLines=[{key:k(1),itemId:'CH-Solar Plate C620',description:'Solar Plates Canadian 620 Watt',unit:'piece',out:'33',sites:[siteId],fixedGroup:'panels',basisLine:0},{key:k(2),itemId:'CH-BAT-HV-05 KW',description:'HV 5kWh battery',unit:'piece',out:'6',sites:[siteId],fixedGroup:'bess',basisLine:3},{key:k(3),itemId:'CH-BMS-HV',description:'HV BMS',unit:'piece',out:'2',sites:[siteId],fixedGroup:'bess',basisLine:4},{key:k(4),itemId:'CH-DB Box 14x20',description:'DB Box 14x20',unit:'piece',out:'1',sites:[siteId],fixedGroup:'other',basisLine:9},{key:k(5),itemId:'CH-Earthing',description:'UBL earthing bore',unit:'No.',out:'2',sites:[siteId],fixedGroup:'panels',basisLine:19},{key:k(6),itemId:'CH-SOLARBOX-18*24',description:'DB Solar  Box 18x24',unit:'piece',out:'1',sites:[siteId],fixedGroup:'other'}];
 const variableLines=[{key:k(7),itemId:'CH-Duct Slot 60x60',description:'Duct slot 60x60',unit:'piece',out:'28',sites:[siteId],section:'customer',documentPolicyVersion:2},{key:k(8),itemId:'CH-Pvc Pipe 1.5 Inch',description:'PVC Pipe 1.5 Inch',unit:'piece',out:'80',sites:[siteId],section:'customer',documentPolicyVersion:2}];
 const transport={issuedTo:'Fixture team',vehicle:'Fixture vehicle',driver:'Fixture driver',driverIdentity:''};
 const catalogue=[...fixedLines,...variableLines].filter(r=>r.itemId!=='CH-Earthing').map(r=>({itemId:r.itemId,description:r.description,units:[r.unit]}));
 await page.route('**/api/material-dispatches/**',async route=>{
  const path=new URL(route.request().url()).pathname.replace('/api/material-dispatches','');
  if(path==='/access')return route.fulfill({json:{kind:'management'}});
  if(path==='/intake')return route.fulfill({json:{sources:[source],catalogue,warehouses:['Lahore warehouse']}});
  if(path==='/site-plans/'+id)return route.fulfill({json:{id,version:1,variableSupply:'single-site',fixed:{id:draftId,version:1,snapshot:{kind:'fixed',parent:false,warehouse:'Lahore warehouse',sites:[source],lines:fixedLines,transport}},variable:{id:variableId,version:1,snapshot:{kind:'variable',parent:false,warehouse:'Lahore warehouse',sites:[source],lines:variableLines,transport}}}});
  if(path==='/stock')return route.fulfill({json:{authority:{state:'active',source_sha256:'a'.repeat(64),version:1},positions:catalogue.map(c=>({itemId:c.itemId,unit:c.units[0],currentClosing:'100',ledgerRevision:0}))}});
  if(path==='/transport-choices')return route.fulfill({json:{choices:[]}});
  if(path==='/site-plans/'+id+'/issued')return route.fulfill({json:{dispatches:[{id:'99999999-9999-4999-8999-999999999999',number:'CPZ-DO-26-0043',createdAt:'2026-11-22T11:05:47.086Z',partialDelivery:true,additional:false,variable:true,lines:[...fixedLines.filter(r=>r.itemId!=='CH-Earthing'),...variableLines].map(r=>({key:r.key,itemId:r.itemId,unit:r.unit,quantity:r.out}))}]}});
  if(path.endsWith('/movements'))return route.fulfill({json:{dispatches:[],receipts:[],lines:[]}});
  return route.fulfill({json:{versions:[],files:[]}});
 });
 await page.goto('/inventory/materials/'+id);
 const fixed=page.getByRole('region',{name:'Fixed material issuance',exact:true});
 await fixed.getByText('DB Solar  Box 18x24').first().click({button:'right'});
 await page.getByRole('searchbox',{name:'Search inventory item ID or name',exact:true}).fill('solar structure');
 await page.getByRole('option',{name:/CH-Solar Structure/}).click();
 await fixed.getByRole('combobox',{name:/^Solar structure size/}).selectOption('3');
 await expect(fixed.getByLabel('Issued quantity CH-Solar Structure',{exact:true})).toHaveText('1');
 await expect(fixed.locator('strong.issue-boq-item-id',{hasText:'CH-SOLARBOX-18*24'})).toBeVisible();
 await page.getByRole('button',{name:'Preview & Save DO',exact:true}).click();
 const review=page.getByRole('dialog',{name:'Review DO before saving'});
 await expect(review).toContainText('Solar structure — 3 kW');
});
