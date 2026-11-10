import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
for(const parent of [false,true])test(`QC usage ${parent?'Parent pool':'individual DO'} records use without returns or IRRs`,async({page})=>{
 await actors(page.request);await login(page.request);
 const signedDo={id:'do',name:'Signed DO',mediaType:'image/png'},vso={id:'vso',name:'Signed VSO',mediaType:'image/png'};
 const site={id:'usage-site',ipo:'CHP-USAGE',name:'Material usage fixture',customer:'UBL',operationsTeam:'central',installation:true,projectType:'ups',stage:'delivered',version:1,accounts:[],history:[],blockers:[],deliveries:[],documents:[]};
 await page.route('**/api/operations-board/sites',r=>r.fulfill({json:{sites:[site],access:{kind:'qc',team:'central',name:'QC'}}}));
 await page.route('**/api/operations-board/sites/usage-site',r=>r.fulfill({json:site}));
 const line=(key:string,itemId:string,variable:boolean,issued:string|null)=>({key,itemId,description:key==='fixed'?'Fixed item with a longer description that wraps into a separate line':'Measured cable',unit:variable?'m':'pcs',issued,variable});
 const record={draftId:'draft',siteId:'site',parent,kind:parent?'variable':'fixed',warehouse:'Lahore',references:[parent?'PDO-0001':'DO-0001'],report:null as any,lines:parent?[line('cable','CH-CBL-COM',true,null)]:[line('fixed','CH-VDP-2P',false,'2'),line('cable','CH-CBL-COM',true,'10.5')]};
 await page.route('**/api/material-dispatches/qc/sites/usage-site/material-usage',r=>r.fulfill({json:{records:[record],evidence:{signedDos:[signedDo],variableSignoff:vso,noVariableItemsUsed:false}}}));
 let purchases:any={version:0,items:[]},purchaseBody:any;
 await page.route('**/api/operations-board/sites/usage-site/local-purchases',async r=>{if(r.request().method()==='POST'){purchaseBody=r.request().postDataJSON();purchases={version:1,items:purchaseBody.items};return r.fulfill({json:{version:1,stockPosting:false}});}return r.fulfill({json:purchases});});
 let body:any;await page.route('**/api/material-dispatches/site-usage',async r=>{body=r.request().postDataJSON();record.report={version:1,snapshot:body};await r.fulfill({json:{version:1,stockPosting:false}});});
 await page.goto('/operations/sites/usage-site');
 const module=page.locator('section').filter({has:page.getByRole('heading',{name:'Material Usage',exact:true})});
 await module.getByRole('button',{name:'Open material usage',exact:true}).click();
 await expect(module.getByRole('heading',{name:'Fixed items',exact:true})).toBeVisible();await expect(module.getByRole('heading',{name:'Variable items',exact:true})).toBeVisible();
 await expect(module.locator('input[type=file]')).toHaveCount(0);await expect(module.getByRole('columnheader',{name:/return|IRR/i})).toHaveCount(0);
 if(!parent){await module.getByRole('checkbox',{name:'All fixed items used as issued',exact:true}).check();await expect(module.getByLabel('Used CH-VDP-2P',{exact:true})).toHaveValue('2');await module.getByLabel('Used CH-VDP-2P',{exact:true}).fill('1');await expect(module.getByRole('checkbox',{name:'All fixed items used as issued',exact:true})).not.toBeChecked();await expect(module.getByText('10.5',{exact:true})).toBeVisible();}
 else await expect(module.getByRole('columnheader',{name:'Issued',exact:true})).toHaveCount(0);
 await module.getByLabel('Used CH-CBL-COM',{exact:true}).fill('7.25');await module.getByLabel('Usage date',{exact:true}).fill('2026-11-01');await module.getByLabel('Verification note',{exact:true}).fill('Confirmed with Operations and signed VSO.');
 await module.getByRole('button',{name:'Add local purchase item',exact:true}).click();
 await module.getByLabel('Local purchase item ID 1',{exact:true}).fill('CH-PVC-TAPE');await module.getByLabel('Local purchase description 1',{exact:true}).fill('Locally purchased insulation tape');await module.getByLabel('Local purchase quantity 1',{exact:true}).fill('3');
 await module.getByRole('button',{name:'Add local purchase item',exact:true}).click();await module.getByRole('button',{name:'Remove local purchase item 2',exact:true}).click();await expect(module.getByLabel('Local purchase item ID 2',{exact:true})).toHaveCount(0);
 await module.getByRole('button',{name:'Submit Local Purchases for Accounts',exact:true}).click();await expect(module.getByText('Local purchases saved for Accounts. No stock or PT amounts were posted.',{exact:true})).toBeVisible();
 await page.screenshot({path:`test-results/qc-usage-${parent?'parent':'individual'}.png`,fullPage:true});
 await module.getByRole('button',{name:'Verify & Save Material Usage',exact:true}).click();await expect(module.getByText('Material usage saved for Inventory reconciliation. Warehouse stock is unchanged.',{exact:true})).toBeVisible();
 await expect(module.getByLabel('Local purchase item ID 1',{exact:true})).toHaveValue('CH-PVC-TAPE');await expect(module.getByLabel('Local purchase quantity 1',{exact:true})).toHaveValue('3');
 expect(body.localPurchases).toBeUndefined();expect(purchaseBody.items).toHaveLength(1);expect(purchaseBody.items[0]).toMatchObject({itemId:'CH-PVC-TAPE',description:'Locally purchased insulation tape',quantity:'3'});
 expect(body.workflowVersion).toBe(2);expect(body.lines.find((l:any)=>l.lineKey==='cable')).toMatchObject({issued:parent?null:'10.5',used:'7.25',returned:null});expect(body.lines.every((l:any)=>l.returned===null)).toBe(true);expect(body.customerEvidenceId).toBe('vso');expect(body.internalEvidenceId).toBe(parent?null:'do');
});

test('QC can draft and verify historical DO quantities from the site material form',async({page})=>{
 await actors(page.request);await login(page.request);
 const boardId='historical-usage-fixture',signedDo={id:'do',name:'Signed DO',mediaType:'image/png'};
 const site={id:boardId,ipo:'CHP-USAGE',name:'Historical material usage fixture',customer:'UBL',operationsTeam:'central',installation:true,projectType:'ups',stage:'delivered',version:1,accounts:[],history:[],blockers:[],deliveries:[],documents:[]};
 await page.route('**/api/operations-board/sites',r=>r.fulfill({json:{sites:[site],access:{kind:'qc',team:'central',name:'QC'}}}));
 await page.route('**/api/operations-board/sites/'+boardId,r=>r.fulfill({json:site}));
 await page.route('**/api/operations-board/sites/'+boardId+'/local-purchases',r=>r.fulfill({json:{version:0,items:[]}}));
 await page.route('**/api/material-dispatches/qc/sites/'+boardId+'/material-usage',r=>r.fulfill({json:{records:[],evidence:{signedDos:[signedDo],variableSignoff:null,noVariableItemsUsed:true}}}));
 const issued=[
  {key:'long',itemId:'CH-BMS-HV',description:'Historical evidence with a long description that wraps onto another line without moving the item ID, DO reference, or used quantity field.',unit:'pcs',issued:'2',reference:'DO-0001'},
  {key:'short',itemId:'CH-VPD-2P',description:'',unit:'pcs',issued:'1',reference:'DO-0001'},
 ];
 let body:any,version=0;
 await page.route('**/api/material-dispatches/qc/sites/'+boardId+'/historical-usage',async r=>{
  if(r.request().method()==='POST'){body=r.request().postDataJSON();version++;return r.fulfill({json:{version,stockPosting:false}});}
  return r.fulfill({json:{linkedIssues:true,issued,version,entry:body?.entry??null,needsSignedDo:false,needsVso:false}});
 });
 await page.goto('/operations/sites/'+boardId);
 const module=page.locator('section').filter({has:page.getByRole('heading',{name:'Material Usage',exact:true})});
 await module.getByRole('button',{name:'Open material usage',exact:true}).click();
 await expect(module.getByRole('columnheader',{name:'DO reference'})).toBeVisible();
 const rows=module.locator('.qc-history-usage-table tbody tr');
 for(const row of await rows.all()){
  const label=await row.locator('td strong').boundingBox(),reference=await row.locator('td:nth-child(3) span').boundingBox(),input=await row.getByRole('textbox').boundingBox();
  expect(Math.abs(label!.y-reference!.y)).toBeLessThan(2);
  expect(Math.abs(label!.y-input!.y)).toBeLessThan(2);
 }
 await module.getByLabel('Actual used CH-BMS-HV DO-0001 row 1').fill('1');
 await module.getByLabel('Verification note',{exact:true}).fill('Read original DO and confirmed fixed item usage');
 await module.getByRole('button',{name:'Save usage draft',exact:true}).click();
 await expect(module.getByRole('status').filter({hasText:'Usage saved.'})).toBeVisible();
 expect(body.verify).toBe(false);
 await expect(module.getByLabel('Verification note',{exact:true})).toHaveValue('');
 await module.getByLabel('Actual used CH-VPD-2P DO-0001 row 2').fill('0');
 await module.getByLabel('Verification note',{exact:true}).fill('Confirmed both lines against the signed delivery record');
 await module.getByRole('button',{name:'Verify Usage',exact:true}).click();
 await expect.poll(()=>body.verify).toBe(true);
 expect(body.entry.usage).toEqual({long:'1',short:'0'});
});
