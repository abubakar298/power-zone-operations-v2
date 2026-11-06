import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {actors,login} from './release-fixtures.js';
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
 await select('Management');await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
 await select('Design');await expect(page.getByRole('button',{name:'View as',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Survey History',exact:true})).toBeVisible();
 await select('Project Coordination');await expect(page.getByRole('button',{name:'View as',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'View as',exact:true})).toHaveAttribute('title','Current view: Project Coordination');
 await select('Inventory / Store');await expect(page.getByRole('button',{name:'View as',exact:true})).toHaveAttribute('title','Current view: Inventory / Store');await aligned();
 await page.setViewportSize({width:390,height:844});await aligned();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/inventory-header-mobile.png',fullPage:false});await page.setViewportSize({width:1280,height:900});
 for(const path of ['/inventory/parent-dos','/inventory/reconciliations','/inventory/transfers','/inventory/replacements','/inventory/gate-passes','/inventory/materials?site=header-test']){await page.goto(path);await expect(page.getByRole('button',{name:'View as',exact:true})).toBeVisible();await aligned();}
 await select('Operations');await expect(page.getByRole('heading',{name:'Site updates',exact:true})).toBeVisible();await page.screenshot({path:'test-results/operations-header-desktop.png',fullPage:false});
 await page.getByRole('button',{name:'Account menu',exact:true}).click();await page.getByRole('menuitem',{name:'Sign out',exact:true}).click();await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
 await login(page.request,'moaz-header@example.test');await page.goto('/operations/sites');await expect(page.getByRole('heading',{name:'Site updates',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'View as',exact:true})).toHaveCount(0);
 }finally{await pool.end();}
});
