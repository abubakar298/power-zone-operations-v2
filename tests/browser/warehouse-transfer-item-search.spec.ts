import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
test('transfer item can be typed to narrow the list, then picked with its destination unit',async({page})=>{
 await actors(page.request);await login(page.request);
 const authority=(warehouse:string)=>({warehouse,source_sha256:'a'.repeat(64),version:1,state:'active'});
 const position=(warehouse:string,itemId:string,description:string,unit='piece',closing='10')=>({ledgerKey:warehouse+':'+itemId+':'+unit,itemId,description,unit,ledgerRevision:1,reviewedClosing:true,currentClosing:closing});
 const source=[position('Karachi warehouse','CH-BAT-100AH','Lithium battery 100Ah','piece','12'),position('Karachi warehouse','CH-BRK-DC-20A/4P','DC breaker 20A 4 pole'),position('Karachi warehouse','CH-CBL-4MM','Solar cable 4mm','meter','300')];
 const destination=[position('Lahore warehouse','CH-BAT-100AH','Lithium battery 100Ah','piece','3'),position('Lahore warehouse','CH-CBL-4MM','Solar cable 4mm','meter','50')];
 let issued:any;
 await page.route('**/api/warehouse-transfers**',async route=>{
  const path=new URL(route.request().url()).pathname.replace('/api/warehouse-transfers','');
  if(path==='/access')return route.fulfill({json:{enabled:true,kind:'dispatcher',warehouses:['Karachi warehouse','Lahore warehouse'],readWarehouses:['Karachi warehouse'],sourceWarehouses:['Karachi warehouse'],receiptWarehouses:[]}});
  if(path==='/intake')return route.fulfill({json:{source:{warehouse:'Karachi warehouse',authority:authority('Karachi warehouse'),positions:source},destination:{warehouse:'Lahore warehouse',authority:authority('Lahore warehouse'),positions:destination}}});
  if(path==='/issues'){issued=route.request().postDataJSON();return route.fulfill({json:{id:'tr-1',number:'TR-1'}});}
  if(path==='')return route.fulfill({json:{records:[]}});
  return route.fulfill({status:404,json:{error:'Not mocked'}});
 });
 await page.setViewportSize({width:1440,height:900});
 await page.goto('/inventory/transfers/new');
 await page.getByLabel('Destination warehouse').selectOption('Lahore warehouse');
 const item=page.getByRole('combobox',{name:'Type or select final item'}).or(page.getByPlaceholder('Type or select final item')).first();
 await expect(item).toBeEditable();
 // Clicking shows the full list.
 await item.click();const list=page.getByRole('listbox',{name:'Type or select final item'});
 await expect(list.getByRole('option')).toHaveCount(3);
 // Typing part of an ID or name narrows it.
 await item.fill('bat');await expect(list.getByRole('option')).toHaveCount(1);
 await item.fill('cable');await expect(list.getByRole('option')).toHaveCount(1);
 await item.fill('nothing like this');await expect(list.getByRole('option')).toHaveCount(0);await expect(list).toContainText('No item in the source warehouse matches.');
 await expect(page.getByRole('button',{name:'Create transfer DO',exact:true})).toBeDisabled();
 await item.fill('BAT');await list.getByRole('option',{name:/CH-BAT-100AH/}).click();
 await expect(item).toHaveValue('CH-BAT-100AH · piece');
 const row=page.getByRole('row').filter({has:item});
 await expect(row).toContainText('Lithium battery 100Ah');await expect(row).toContainText('12');
 const unit=row.getByRole('combobox',{name:/^Destination position /});
 await expect(unit).toHaveValue('Lahore warehouse:CH-BAT-100AH:piece');
 await expect(unit.getByRole('option')).toHaveText(['Select reviewed position','CH-BAT-100AH · piece']);
 // A typed text that is not an exact item clears the choice instead of sending it.
 await item.fill('CH-BAT-100');await expect(unit).toHaveValue('');await expect(unit.getByRole('option')).toHaveText(['Select reviewed position']);
 await list.getByRole('option',{name:/CH-BAT-100AH/}).click();await expect(unit).toHaveValue('Lahore warehouse:CH-BAT-100AH:piece');
 // The item ID stays on its primary line whether or not a description sits underneath.
 const [field,quantityBox]=await Promise.all([item.boundingBox(),row.getByRole('textbox',{name:/^Transfer quantity /}).boundingBox()]);expect(Math.abs(field!.y-quantityBox!.y)).toBeLessThan(2);
 await row.getByRole('textbox',{name:/^Transfer quantity /}).fill('2');
 await page.getByLabel('Dispatch note').fill('Stock balancing');
 await page.getByRole('button',{name:'Create transfer DO',exact:true}).click();
 await expect.poll(()=>issued?.lines).toEqual([expect.objectContaining({itemId:'CH-BAT-100AH',sourceLedgerKey:'Karachi warehouse:CH-BAT-100AH:piece',destinationLedgerKey:'Lahore warehouse:CH-BAT-100AH:piece',quantity:'2'})]);
});

test('during stock reconciliation an item the destination never held gets a new destination line',async({page})=>{
 await actors(page.request);await login(page.request);
 const authority=(warehouse:string)=>({warehouse,source_sha256:'a'.repeat(64),version:1,state:'active'});
 const newKey='f'.repeat(64);let issued:any;
 await page.route('**/api/warehouse-transfers**',async route=>{
  const path=new URL(route.request().url()).pathname.replace('/api/warehouse-transfers','');
  if(path==='/access')return route.fulfill({json:{enabled:true,kind:'dispatcher',warehouses:['Lahore warehouse','Multan warehouse'],readWarehouses:['Lahore warehouse'],sourceWarehouses:['Lahore warehouse'],receiptWarehouses:[]}});
  if(path==='/intake')return route.fulfill({json:{source:{warehouse:'Lahore warehouse',authority:authority('Lahore warehouse'),positions:[{ledgerKey:'1'.repeat(64),itemId:'CH-Duct Slot 60x60',description:'Duct Slot 60x60',unit:'ft',ledgerRevision:4,reviewedClosing:true,currentClosing:'351',newDestinationLedgerKey:newKey}]},destination:{warehouse:'Multan warehouse',authority:authority('Multan warehouse'),positions:[]}}});
  if(path==='/issues'){issued=route.request().postDataJSON();return route.fulfill({json:{id:'tr-2',number:'TR-2'}});}
  if(path==='')return route.fulfill({json:{records:[]}});
  return route.fulfill({status:404,json:{error:'Not mocked'}});
 });
 await page.goto('/inventory/transfers/new');
 await page.getByLabel('Source warehouse').selectOption('Lahore warehouse');
 await page.getByLabel('Destination warehouse').selectOption('Multan warehouse');
 const item=page.getByPlaceholder('Type or select final item');await item.fill('duct');
 await page.getByRole('listbox',{name:'Type or select final item'}).getByRole('option',{name:/CH-Duct Slot 60x60/}).click();
 const row=page.getByRole('row').filter({has:item}),unit=row.getByRole('combobox',{name:/^Destination position /});
 await expect(unit).toHaveValue(newKey);await expect(unit.locator('option:checked')).toHaveText('CH-Duct Slot 60x60 · ft · new line');
 await expect(row).toContainText('New stock line at Multan warehouse · opening not recorded');await expect(row).not.toContainText('needs review');
 await row.getByRole('textbox',{name:/^Transfer quantity /}).fill('154');
 await page.getByLabel('Dispatch note').fill('To avoid local purchase');
 await page.getByRole('button',{name:'Create transfer DO',exact:true}).click();
 await expect.poll(()=>issued?.lines).toEqual([expect.objectContaining({itemId:'CH-Duct Slot 60x60',destinationLedgerKey:newKey,destinationLedgerRevision:0,quantity:'154'})]);
});
