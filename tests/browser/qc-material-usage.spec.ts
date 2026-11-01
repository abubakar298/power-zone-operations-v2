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
 let body:any;await page.route('**/api/material-dispatches/site-usage',async r=>{body=r.request().postDataJSON();record.report={version:1,snapshot:body};await r.fulfill({json:{version:1,stockPosting:false}});});
 await page.goto('/operations/sites/usage-site');
 const module=page.locator('section').filter({has:page.getByRole('heading',{name:'Material Usage',exact:true})});
 await module.getByRole('button',{name:'Open material usage',exact:true}).click();
 await expect(module.getByRole('heading',{name:'Fixed items',exact:true})).toBeVisible();await expect(module.getByRole('heading',{name:'Variable items',exact:true})).toBeVisible();
 await expect(module.locator('input[type=file]')).toHaveCount(0);await expect(module.getByRole('columnheader',{name:/return|IRR/i})).toHaveCount(0);
 if(!parent){await module.getByRole('checkbox',{name:'All fixed items used as issued',exact:true}).check();await expect(module.getByLabel('Used CH-VDP-2P',{exact:true})).toHaveValue('2');await module.getByLabel('Used CH-VDP-2P',{exact:true}).fill('1');await expect(module.getByRole('checkbox',{name:'All fixed items used as issued',exact:true})).not.toBeChecked();await expect(module.getByText('10.5',{exact:true})).toBeVisible();}
 else await expect(module.getByRole('columnheader',{name:'Issued',exact:true})).toHaveCount(0);
 await module.getByLabel('Used CH-CBL-COM',{exact:true}).fill('7.25');await module.getByLabel('Usage date',{exact:true}).fill('2026-11-01');await module.getByLabel('Verification note',{exact:true}).fill('Confirmed with Operations and signed VSO.');
 await page.screenshot({path:`test-results/qc-usage-${parent?'parent':'individual'}.png`,fullPage:true});
 await module.getByRole('button',{name:'Verify & Save Material Usage',exact:true}).click();await expect(module.getByRole('status')).toContainText('Material usage saved');
 expect(body.workflowVersion).toBe(2);expect(body.lines.find((l:any)=>l.lineKey==='cable')).toMatchObject({issued:parent?null:'10.5',used:'7.25',returned:null});expect(body.lines.every((l:any)=>l.returned===null)).toBe(true);expect(body.customerEvidenceId).toBe('vso');expect(body.internalEvidenceId).toBe(parent?null:'do');
});
