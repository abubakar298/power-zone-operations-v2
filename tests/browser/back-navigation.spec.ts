import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {actors,login} from './release-fixtures.js';

// The Back arrow steps back through pages, tabs and cards in the order they were opened,
// without reloading the browser.
const back=(page:Page)=>page.locator('.pz-back-button:not(.pz-dialog-back)').first().click();
// A full page load would clear this marker.
const mark=(page:Page)=>page.evaluate(()=>{(window as any).pzBackMarker='kept';});
const notReloaded=async(page:Page)=>expect(await page.evaluate(()=>(window as any).pzBackMarker)).toBe('kept');
const pressed=(page:Page,name:RegExp|string)=>expect(page.getByRole('button',{name}).first()).toHaveAttribute('aria-pressed','true');
const notPressed=(page:Page,name:RegExp|string)=>expect(page.getByRole('button',{name}).first()).toHaveAttribute('aria-pressed','false');
const selectedTab=(page:Page,name:RegExp)=>expect(page.getByRole('tab',{name})).toHaveAttribute('aria-selected','true');
async function operationsUsers(){
 const fixture=JSON.parse(await readFile(`.local/e2e-fixture-${process.env.PZ_E2E_PORT??'3180'}.json`,'utf8'));
 expect(fixture.marker).toBe('power-zone-disposable-browser-fixture-v1');expect(new URL(fixture.databaseUrl).hostname).toBe('127.0.0.1');
 const pool=new pg.Pool({connectionString:fixture.databaseUrl,max:2});
 try{
  const admin=(await pool.query("SELECT id,password_hash FROM users WHERE email='admin@example.test'")).rows[0];
  for(const [email,name,kind] of [['moaz-back@example.test','Moaz Ahsan','head'],['hamza-back@example.test','Hamza Mir','buyer']] as const){
   if((await pool.query('SELECT 1 FROM users WHERE email=$1',[email])).rowCount)continue;
   const id=randomUUID();
   await pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,'Operations',$4)",[id,email,name,admin.password_hash]);
   if(kind==='head')await pool.query("INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,'head',NULL,$2)",[id,admin.id]);
   else await pool.query("INSERT INTO procurement_access(user_id,capability,granted_reason) VALUES($1,'buyer','Back navigation test')",[id]);
  }
 }finally{await pool.end();}
}

test('Accounts: Back returns through cards and pages in the order opened, without reloading',async({page})=>{
 await actors(page.request);await login(page.request,'accounts-release@example.test');
 await page.goto('/dashboard');await expect(page.getByRole('heading',{name:'Invoicing & Payments',exact:true})).toBeVisible();await page.waitForLoadState('networkidle');await mark(page);
 // Dashboard → Payments to Record → All invoices, then Back twice.
 await page.locator('.accounts-billing-buckets').getByRole('button',{name:/Payments to Record/}).click();
 await pressed(page,/^Awaiting payment/);
 await page.getByRole('button',{name:/^All invoices/}).click();await pressed(page,/^All invoices/);
 await back(page);await pressed(page,/^Awaiting payment/);await notPressed(page,/^All invoices/);
 await back(page);await expect(page.getByRole('heading',{name:'Invoicing & Payments',exact:true})).toBeVisible();
 await notReloaded(page);
 // The browser's own Forward and Back keys follow the same steps.
 await page.goForward();await pressed(page,/^Awaiting payment/);
 await page.goForward();await pressed(page,/^All invoices/);
 // A card chosen on a page comes back after visiting another page.
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Physical Documents',exact:true}).click();
 await expect(page.getByRole('button',{name:/^All invoices/})).toHaveCount(0);
 await back(page);await pressed(page,/^All invoices/);
 await back(page);await pressed(page,/^Awaiting payment/);
 await back(page);await expect(page.getByRole('heading',{name:'Invoicing & Payments',exact:true})).toBeVisible();
 // Invoices to Submit opens from its card; Back returns to the dashboard.
 await page.locator('.accounts-billing-buckets').getByRole('button',{name:/Invoices to Submit/}).click();
 await expect(page.getByRole('heading',{name:'Invoices to Submit',exact:true})).toBeVisible();
 await back(page);await expect(page.getByRole('heading',{name:'Invoicing & Payments',exact:true})).toBeVisible();
 // Sidebar pages, and the Awaiting PT / Recorded switch inside IPOs Received.
 const nav=page.getByRole('navigation',{name:'Main navigation'});
 await nav.getByRole('button',{name:'IPOs Received',exact:true}).click();await expect(page.getByRole('heading',{name:'IPO Entries',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/^Recorded ·/}).click();await pressed(page,/^Recorded ·/);
 await nav.getByRole('button',{name:'Job Closure',exact:true}).click();await expect(page.getByLabel('Job status')).toBeVisible();
 await back(page);await pressed(page,/^Recorded ·/);
 await back(page);await pressed(page,/^Awaiting PT ·/);
 await back(page);await expect(page.getByRole('heading',{name:'Invoicing & Payments',exact:true})).toBeVisible();
 await notReloaded(page);
});

test('Management: Master data tabs, Operations board, Procurement and Inventory cards are Back steps',async({page})=>{
 await actors(page.request);await operationsUsers();await login(page.request,'management-release@example.test');
 // Master data tabs.
 await page.goto('/dashboard#workspace=masters');await page.reload();await selectedTab(page,/^Customers/);await mark(page);
 await page.getByRole('tab',{name:/^Sites/}).click();await page.getByRole('tab',{name:/^Brands/}).click();await selectedTab(page,/^Brands/);
 await back(page);await selectedTab(page,/^Sites/);
 await back(page);await selectedTab(page,/^Customers/);
 await notReloaded(page);
 const viewAs=async(label:string)=>{await page.getByRole('button',{name:'View as',exact:true}).click();await page.getByRole('navigation',{name:'View department workspace'}).getByRole('button',{name:label,exact:true}).click();};
 // Operations board stage and type cards.
 await viewAs('Operations');await expect(page.getByRole('heading',{name:'Site updates',exact:true})).toBeVisible();await mark(page);
 await page.getByRole('button',{name:/Awaiting delivery Delivery evidence/}).click();await page.getByRole('button',{name:/Delivered Installation or QC/}).click();await pressed(page,/Delivered Installation or QC/);
 await page.getByRole('button',{name:'UPS',exact:true}).click();await pressed(page,'UPS');
 await back(page);await notPressed(page,'UPS');await pressed(page,/Delivered Installation or QC/);
 await back(page);await pressed(page,/Awaiting delivery/);
 await back(page);await notPressed(page,/Awaiting delivery/);await expect(page.getByRole('heading',{name:'Site updates',exact:true})).toBeVisible();
 await notReloaded(page);
 // Procurement pages and tabs.
 await viewAs('Procurement');await expect(page.getByRole('button',{name:'Power Zone — Dashboard',exact:true})).toContainText('Procurement');await mark(page);
 await page.getByRole('button',{name:'Requests & RFQs',exact:true}).click();await expect(page.getByRole('heading',{name:'Requests & RFQs',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/^Draft/}).click();await pressed(page,/^Draft/);
 await page.getByRole('button',{name:/^Approved/}).click();await pressed(page,/^Approved/);
 await back(page);await pressed(page,/^Draft/);
 await back(page);await pressed(page,/^All/);
 await back(page);await expect(page.getByRole('heading',{name:'Stock overview',exact:true})).toBeVisible();
 await notReloaded(page);
 // Inventory dashboard buckets and Documents Upload buckets.
 await page.goto('/inventory');await expect(page.getByRole('button',{name:/Upcoming Projects/})).toBeVisible();await mark(page);
 await page.getByRole('button',{name:/PRAs Received/}).click();await page.getByRole('button',{name:/Dispatched — Awaiting QC/}).click();await pressed(page,/Dispatched — Awaiting QC/);
 await back(page);await pressed(page,/PRAs Received/);
 await back(page);await pressed(page,/Upcoming Projects/);
 await notReloaded(page);
 await page.goto('/inventory/gate-passes');await expect(page.getByTestId('document-bucket-dos')).toHaveAttribute('aria-pressed','true');await mark(page);
 await page.getByTestId('document-bucket-purchases').click();await page.getByTestId('document-bucket-transfers').click();
 await back(page);await expect(page.getByTestId('document-bucket-purchases')).toHaveAttribute('aria-pressed','true');
 await back(page);await expect(page.getByTestId('document-bucket-dos')).toHaveAttribute('aria-pressed','true');
 await notReloaded(page);
 // The chosen bucket still survives a reload, as before.
 await page.getByTestId('document-bucket-replacements').click();await page.reload();
 await expect(page.getByTestId('document-bucket-replacements')).toHaveAttribute('aria-pressed','true');
 await back(page);await expect(page.getByTestId('document-bucket-dos')).toHaveAttribute('aria-pressed','true');
});

test('Coordinator: sidebar pages, Master data tabs and UBL workflow filters are Back steps',async({page})=>{
 await actors(page.request);await login(page.request,'coordinator-release@example.test');
 await page.goto('/dashboard');await page.locator('.account-trigger').last().waitFor();await mark(page);
 const shortcuts=page.getByRole('navigation',{name:'Atif shortcuts'});
 await shortcuts.getByRole('button',{name:'Customer & Site Search',exact:true}).click();await expect(shortcuts.getByRole('button',{name:'Customer & Site Search',exact:true})).toHaveAttribute('aria-current','page');
 await shortcuts.getByRole('button',{name:'My Performance',exact:true}).click();await expect(shortcuts.getByRole('button',{name:'My Performance',exact:true})).toHaveAttribute('aria-current','page');
 await back(page);await expect(shortcuts.getByRole('button',{name:'Customer & Site Search',exact:true})).toHaveAttribute('aria-current','page');
 await back(page);await expect(shortcuts.getByRole('button',{name:'Customer & Site Search',exact:true})).not.toHaveAttribute('aria-current','page');
 await notReloaded(page);
 // Master data tabs, including Item Descriptions.
 await page.goto('/dashboard#workspace=masters');await page.reload();await selectedTab(page,/^Customer Database/);await mark(page);
 await page.getByRole('tab',{name:/^Item Descriptions/}).click();await selectedTab(page,/^Item Descriptions/);
 await back(page);await selectedTab(page,/^Customer Database/);
 await notReloaded(page);
 // UBL workflow filters.
 await page.goto('/dashboard#workspace=ubl-workflow');await page.reload();await pressed(page,/^All \d/);await mark(page);
 await page.getByRole('button',{name:'Deferred',exact:true}).click();await notPressed(page,/^All \d/);
 await back(page);await pressed(page,/^All \d/);
 await notReloaded(page);
});
