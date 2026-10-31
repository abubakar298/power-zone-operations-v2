import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {actors,login} from './release-fixtures.js';
import {ProjectWorkflowRepository} from '../../server/project-workflow/repository.js';
import {directPoSuggestions} from '../../shared/direct-po-reading.js';

for(const readable of [false,true])test(`Saved Consumer Hub Direct PO ${readable?'restores its printed reference':'allows correction of a missing reference'} without issuing an IPO`,async({page})=>{
 await actors(page.request);await login(page.request,'coordinator-release@example.test');
 const fixture=JSON.parse(await readFile(`.local/e2e-fixture-${process.env.PZ_E2E_PORT??'3180'}.json`,'utf8'));
 expect(fixture.marker).toBe('power-zone-disposable-browser-fixture-v1');expect(new URL(fixture.databaseUrl).hostname).toBe('127.0.0.1');
 const pool=new pg.Pool({connectionString:fixture.databaseUrl,max:2});
 try{
  const actor=(await pool.query("SELECT id FROM users WHERE email='coordinator-release@example.test'")).rows[0].id;
  const framework=(await pool.query("SELECT id FROM project_framework_current WHERE configuration_key='MBL-UPS-6-10'")).rows[0];
  const repo=new ProjectWorkflowRepository(pool),code=readable?'CH-PRINTED':'CH-MISSING',name='Consumer Hub '+code;
  const previous=process.env.ENABLE_DEFERRED_UPS_WORKFLOW;let id:string;
  try{process.env.ENABLE_DEFERRED_UPS_WORKFLOW='true';id=(await repo.create(actor,{requestKey:randomUUID(),customerId:(await pool.query('SELECT customer_id FROM project_framework_current WHERE id=$1',[framework.id])).rows[0].customer_id,siteName:name,siteCode:code,route:'direct-framework',frameworkId:framework.id,notes:'Isolated saved PO review regression'})).id;}
  finally{if(previous===undefined)delete process.env.ENABLE_DEFERRED_UPS_WORKFLOW;else process.env.ENABLE_DEFERRED_UPS_WORKFLOW=previous;}
  const file=await repo.attach(actor,id,{kind:'PO / confirmation',filename:'approval.png',mime:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='});
  const text=`Branch code: ${code}\nBranch name: ${name}`+(readable?'\nCustomer PO reference: MBL-CH-0201':'');
  const extracted=directPoSuggestions(text),values={...extracted,siteCode:code,siteName:name,approvalDate:'2026-10-30',approvalSubject:'Customer PO approval'};
  const detail=await repo.detail(actor,id);
  await repo.action(actor,id,{version:detail.record.version,requestKey:randomUUID(),action:'save-direct-po-details',input:{evidenceId:file.id,evidenceType:'Customer PO',extracted,sourceText:text,values,notes:'Saved before opening IPO review'}});
  let issued=0;const previews:any[]=[];
  page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith(`/${id}/actions`)&&request.postDataJSON()?.action==='receipt')issued++;if(request.url().endsWith(`/${id}/sale-preview`))previews.push(request.postDataJSON());});
  await page.goto('/dashboard');
  await page.locator('tr').filter({hasText:name}).getByRole('button',{name:'Open site record',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Review IPO',exact:true})).toBeVisible();
  const reference=page.getByLabel('Customer PO reference',{exact:true});
  await expect(reference).toHaveValue(readable?'MBL-CH-0201':'');
  if(!readable){
   await expect(page.getByRole('alert')).toHaveCount(1);await expect(page.getByText('Enter the Customer PO reference.',{exact:true})).toHaveCount(1);
   await page.getByRole('button',{name:'Preview IPO & PT',exact:true}).click();expect(previews).toHaveLength(0);
   await reference.fill('MBL-CH-CORRECTED');
  }
  if(!readable){const response=page.waitForResponse(r=>r.url().endsWith(`/${id}/sale-preview`));await page.getByRole('button',{name:'Preview IPO & PT',exact:true}).click();expect((await response).status()).toBe(200);}
  await expect(page.getByLabel('I reviewed the IPO and PT breakup for Accounts.',{exact:true})).toBeVisible();
  expect(previews.at(-1).reference).toBe(readable?'MBL-CH-0201':'MBL-CH-CORRECTED');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button',{name:'Edit record',exact:true}).click();
  await page.getByLabel('Customer PO reference',{exact:true}).fill('MBL-CH-SAVED-'+code);
  const saved=page.waitForResponse(r=>r.url().endsWith(`/${id}/actions`)&&r.request().postDataJSON()?.action==='save-direct-po-details');
  await page.getByRole('button',{name:'Save corrections',exact:true}).click();expect((await saved).status()).toBe(200);
  await page.reload();await page.locator('tr').filter({hasText:name}).getByRole('button',{name:'Open site record',exact:true}).click();
  await expect(page.getByLabel('Customer PO reference',{exact:true})).toHaveValue('MBL-CH-SAVED-'+code);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/consumer-hub-${code}-review.png`,fullPage:true});
  expect(issued).toBe(0);expect((await pool.query('SELECT stage FROM project_workflow_records WHERE id=$1',[id])).rows[0].stage).toBe('po_receipt');
 }finally{await pool.end();}
});
