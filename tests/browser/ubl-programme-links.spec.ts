import {test,expect} from '@playwright/test';import {readFile} from 'node:fs/promises';import pg from 'pg';import {randomUUID} from 'node:crypto';
import {actors,login} from './release-fixtures.js';import {ProjectWorkflowRepository} from '../../server/project-workflow/repository.js';
test('UBL Solar linked sites and programme checkpoints include a new survey before IPO without fabricated prices',async({page})=>{
 await actors(page.request);await login(page.request);const fixture=JSON.parse(await readFile(`.local/e2e-fixture-${process.env.PZ_E2E_PORT??'3180'}.json`,'utf8'));expect(fixture.marker).toBe('power-zone-disposable-browser-fixture-v1');expect(new URL(fixture.databaseUrl).hostname).toBe('127.0.0.1');const pool=new pg.Pool({connectionString:fixture.databaseUrl,max:1});
 try{
 const actor=(await pool.query("SELECT id FROM users WHERE role='Coordinator' AND active LIMIT 1")).rows[0].id,framework=(await pool.query("SELECT id FROM project_framework_current WHERE customer_id=5 AND configuration_key='25-20-30:Revised'")).rows[0].id;
 const name='Programme browser survey '+randomUUID().slice(0,6);await new ProjectWorkflowRepository(pool).create(actor,{requestKey:randomUUID(),customerId:5,siteName:name,siteCode:'PROGRAMME-BROWSER-'+randomUUID().slice(0,6),route:'survey-framework',frameworkId:framework,notes:'Disposable browser fixture'});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/dashboard#workspace=ubl');await page.getByRole('button',{name:'Linked sites',exact:true}).click();await page.getByLabel('Search site, branch, region, city, PO or IPO').fill(name);
 const row=page.getByRole('row').filter({hasText:name});await expect(row).toHaveCount(1);await expect(row).toContainText('Pre-IPO');await expect(row).toContainText('Not issued');await expect(row).toContainText('25-20-30');await row.getByText('View saved detail',{exact:true}).click();await expect(row).toContainText('Survey and quotation tracked here');
 await page.getByRole('button',{name:'Operations checkpoints',exact:true}).click();await page.getByLabel('Search job ID, site or configuration').fill(name);await expect(page.getByRole('row').filter({hasText:name})).toHaveCount(1);expect(errors).toEqual([]);
 await page.screenshot({path:'test-results/ubl-programme-survey-linked.png',fullPage:true});
 }finally{await pool.end();}
});
