import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {actors,login} from './release-fixtures.js';
import {materialStockFixture} from '../material-stock-fixture.js';
test('Management keeps View as beside account controls across shared module shells and mobile Operations',async({page})=>{
 await actors(page.request);
 const fixture=JSON.parse(await readFile(`.local/e2e-fixture-${process.env.PZ_E2E_PORT??'3180'}.json`,'utf8'));
 expect(fixture.marker).toBe('power-zone-disposable-browser-fixture-v1');expect(new URL(fixture.databaseUrl).hostname).toBe('127.0.0.1');
 const pool=new pg.Pool({connectionString:fixture.databaseUrl,max:2});
 try{
 const admin=(await pool.query("SELECT id,password_hash FROM users WHERE email='admin@example.test'")).rows[0],head=randomUUID();
 await pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,'moaz-header@example.test','Moaz Ahsan','Operations',$2)",[head,admin.password_hash]);
 await pool.query("INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,'head',NULL,$2)",[head,admin.id]);
 await login(page.request,'management-release@example.test');await page.goto('/dashboard');
 const select=async(label:string)=>{await page.getByRole('button',{name:'View as',exact:true}).click();await page.getByRole('navigation',{name:'View department workspace'}).getByRole('button',{name:label,exact:true}).click();};
 await select('Operations');await expect(page.getByRole('heading',{name:'Site updates',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Return to Management',exact:true})).toHaveCount(0);
 const header=page.locator('header.ob-header');await expect(header.getByRole('button',{name:'View as',exact:true})).toBeVisible();await expect(header.getByRole('button',{name:'Account menu',exact:true})).toBeVisible();
 const aligned=async()=>{const v=await page.getByRole('button',{name:'View as',exact:true}).boundingBox(),a=await page.getByRole('button',{name:'Account menu',exact:true}).boundingBox();expect(v!.x+v!.width).toBeLessThanOrEqual(a!.x);expect(Math.abs(v!.y+v!.height/2-a!.y-a!.height/2)).toBeLessThan(4);};
 await aligned();await page.setViewportSize({width:390,height:844});await aligned();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/operations-header-mobile.png',fullPage:false});await page.setViewportSize({width:1280,height:900});
 await select('Accounts');await expect(page.getByRole('heading',{name:/^Welcome,/})).toBeVisible();await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Material Costing & PT Entry',exact:true})).toBeVisible();
 await select('Procurement');await expect(page.getByRole('button',{name:'Power Zone — Dashboard',exact:true})).toContainText('Procurement');await expect(page.getByRole('button',{name:'View as',exact:true})).toBeVisible();await aligned();await page.setViewportSize({width:390,height:844});await aligned();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.setViewportSize({width:1280,height:900});await page.reload();await expect(page.getByRole('button',{name:'View as',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Stock overview',exact:true})).toBeVisible();
 await expect(page.getByRole('navigation',{name:'Procurement workspace',exact:true}).getByRole('button')).toHaveText(['Stock overview','Requests & RFQs','Suppliers','Owner approvals','Accounts · Salaas','Inventory · IGPO']);
 const createButton=page.getByRole('button',{name:'Create request',exact:true});
 await expect(createButton).toHaveCSS('background-color','rgb(81, 67, 148)');
 await expect(createButton).toHaveCSS('border-radius','8px');
 expect(await page.locator('.procurement-workspace').evaluate(element=>getComputedStyle(element).fontFamily)).toContain('system-ui');
 await page.screenshot({path:'test-results/procurement-stock-desktop.png',fullPage:false});
 await select('Management');await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
 await select('Design');await expect(page.getByRole('button',{name:'View as',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Survey History',exact:true})).toBeVisible();
 await select('Project Coordination');await expect(page.getByRole('button',{name:'View as',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'View as',exact:true})).toHaveAttribute('title','Current view: Project Coordination');
 await select('Inventory / Store');await expect(page.getByRole('button',{name:'View as',exact:true})).toHaveAttribute('title','Current view: Inventory / Store');await aligned();
 await page.setViewportSize({width:390,height:844});await aligned();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/inventory-header-mobile.png',fullPage:false});await page.setViewportSize({width:1280,height:900});
 for(const path of ['/inventory/parent-dos','/inventory/reconciliations','/inventory/transfers','/inventory/replacements','/inventory/gate-passes','/inventory/materials?site=header-test']){await page.goto(path);await expect(page.getByRole('button',{name:'View as',exact:true})).toBeVisible();await aligned();}
 await select('Operations');await expect(page.getByRole('heading',{name:'Site updates',exact:true})).toBeVisible();await page.screenshot({path:'test-results/operations-header-desktop.png',fullPage:false});
 await page.getByRole('button',{name:'Account menu',exact:true}).click();await page.getByRole('menuitem',{name:'Sign out',exact:true}).click();await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
 await login(page.request,'moaz-header@example.test');await page.goto('/operations/sites');await expect(page.getByRole('heading',{name:'Site updates',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'View as',exact:true})).toHaveCount(0);
 const buyer=randomUUID();
 await pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,'buyer-header@example.test','Test Procurement Buyer','Operations',$2)",[buyer,admin.password_hash]);
 await pool.query("INSERT INTO procurement_access(user_id,capability,granted_reason) VALUES($1,'buyer','browser fixture')",[buyer]);
 const warehouse='Lahore warehouse';
 const items=[['CH-BRK-AC-10A/1P','piece'],['CH-CABLE-TIES','packet']];
 await materialStockFixture(pool,'CH-CBL-DC-16MM/1C-B',{canonicalIds:4},items.map(([itemId,unit])=>({
  itemId,unit,warehouse,description:itemId,opening:9,in:0,out:0,closing:9,openingStatus:'Reviewed source',review:'',
 })));
 const buyerHeaders=await login(page.request,'buyer-header@example.test');
 const dummy=await page.request.post('/api/procurement/requests',{headers:buyerHeaders,data:{title:'Dummy request from the old portal'}});
 expect(dummy.ok(),await dummy.text()).toBe(true);
 await page.goto('/dashboard#workspace=stock');
 await expect(page.getByRole('heading',{name:'Stock overview',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Requests & RFQs',exact:true}).click();
 await expect(page.getByText('No requests here.')).toBeVisible();
 await expect(page.getByText('Dummy request from the old portal')).toHaveCount(0);
 await page.getByRole('button',{name:'Select items for a new request',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Create request',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Back to stock overview',exact:true}).click();
 await expect(page.getByLabel('Warehouse',{exact:true})).toHaveValue('');
 const first=page.getByRole('row').filter({hasText:items[0][0]}).first();
 await first.getByRole('button',{name:'Add to request',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Add selected items',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Back to stock overview',exact:true}).click();
 await page.getByRole('button',{name:'Clear selection',exact:true}).click();
 for(const [id,unit] of items)await page.getByRole('checkbox',{name:`Select ${id} (${unit}) at ${warehouse}`,exact:true}).check();
 await page.getByRole('button',{name:'Add selected to request',exact:true}).click();
 await expect(page.getByRole('columnheader',{name:'On hand',exact:true})).toBeVisible();
 await expect(page.getByRole('columnheader',{name:'After reservations',exact:true})).toBeVisible();
 await page.getByLabel('Request title (required)',{exact:true}).fill('Replacement warehouse request');
 for(const [id,unit] of items)await page.getByLabel(`Quantity for ${id} (${unit})`,{exact:true}).fill('2');
 await page.getByRole('button',{name:'Create purchase request',exact:true}).click();
 await expect(page.getByRole('heading',{name:/Replacement warehouse request$/})).toBeVisible();
 for(const [label,empty] of [['Owner approvals','Nothing is waiting for your approval.'],['Accounts · Salaas','There are no approved purchases in this queue.'],['Inventory · IGPO','No requests here.']]){
  await page.getByRole('button',{name:label,exact:true}).click();
  await expect(page.getByText(empty,{exact:true})).toBeVisible();
 }
 }finally{await pool.end();}
});
