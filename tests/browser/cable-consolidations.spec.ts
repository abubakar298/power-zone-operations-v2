import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {actors,login} from './release-fixtures.js';
import {AccountsSourceRegisters} from '../../server/accounts/source-registers.js';
test('Management replaces selected cable invoices and Accounts sees one created invoice awaiting submission',async({page})=>{
 await actors(page.request);await login(page.request,'management-release@example.test');
 const fixture=JSON.parse(await readFile(`.local/e2e-fixture-${process.env.PZ_E2E_PORT??'3180'}.json`,'utf8'));
 expect(fixture.marker).toBe('power-zone-disposable-browser-fixture-v1');expect(new URL(fixture.databaseUrl).hostname).toBe('127.0.0.1');
 const pool=new pg.Pool({connectionString:fixture.databaseUrl,max:1});try{
 const directory=(await pool.query("SELECT current_database() AS name,current_setting('data_directory') AS directory")).rows[0];if(directory.name!=='power_zone_test'||!/[\\/]pz-v2-test-[^\\/]+[\\/]db$/.test(directory.directory))throw Error('Owned disposable database required.');
 const admin=(await pool.query("SELECT id FROM users WHERE email='admin@example.test'")).rows[0].id;
 const cable=(key:string,invoice:string,site:string,amount:string)=>({key,invoice,program:'MBL UPS',sites:[{site,ipo:'CHP-220'}],invoicedAmount:amount,pendingAmount:amount,submission:'Submitted',observations:[{submitted:true,submissionEvidence:'2026-06-15'}],notes:[]});
 await new AccountsSourceRegisters(pool).import(admin,{sourceDate:'2026-10-31',manifest:[{name:'Owned browser fixture',sha256:'a'.repeat(64)}],registers:[{rows:[]}],cables:{rows:[cable('one','26-20214','Tangi','2850'),cable('two','26-20215','Pano Aqil','11000'),cable('retained','27-20123','Eight sites','35591'),cable('multan','27-20126','Multan Road','14854')]},internet:{rows:[]},sites:{rows:[]},evidence:{rows:[],cableStageAdjustments:[]}},0);
 await page.goto('/dashboard#workspace=finance&accountsTab=Payments+to+Record');await page.getByRole('button',{name:'Replace cable invoices',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('Customer for consolidation').selectOption({label:'Meezan Bank Limited'});await dialog.getByRole('button',{name:'Select all matching invoices',exact:true}).click();
 for(const invoice of ['27-20123','27-20126'])await dialog.getByRole('checkbox',{name:'Include invoice '+invoice,exact:true}).uncheck();
 await expect(dialog.getByText('2 invoices selected',{exact:true})).toBeVisible();await dialog.getByLabel('Consolidated invoice number').fill('26-20214');await dialog.getByLabel('Consolidated invoice date').fill('2026-08-24');await dialog.getByLabel('Consolidated total including GST').fill('155949.51');await dialog.getByLabel('Reason for replacing earlier invoices').fill('Reviewed replacement at approved rates. Created only; actual submission remains pending.');await dialog.getByLabel('Original consolidated invoice').setInputFiles({name:'replacement.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\noriginal test fixture')});
 await dialog.getByRole('button',{name:'Create consolidated invoice — submission pending',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'earlier entries are retained'})).toBeVisible();
 const data=await(await page.request.get('/api/accounts-workspace/payment-records')).json();expect(data.awaiting.map((r:any)=>r.invoice).sort()).toEqual(['27-20123','27-20126']);
 await page.goto('/dashboard#workspace=finance&accountsTab=Invoicing');await page.reload();await page.getByRole('button',{name:/^Extra Cable 1 /}).click();await expect(page.getByRole('row').filter({hasText:'26-20214'})).toContainText('Created');
 await page.screenshot({path:'test-results/cable-consolidation-created-pending.png',fullPage:false});
 }finally{await pool.end();}
});
