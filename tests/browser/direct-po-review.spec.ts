import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {jsPDF} from 'jspdf';
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
  await page.getByRole('navigation',{name:'Atif shortcuts'}).getByRole('button',{name:'Direct PO',exact:true}).click();
  await page.getByRole('row').filter({hasText:name}).getByRole('button',{name:'Review IPO',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Review IPO',exact:true})).toBeVisible();
  await expect(page.getByLabel('Invoice terms',{exact:true})).toHaveValue('completion');
  const reference=page.getByLabel('Customer PO reference',{exact:true});
  await expect(reference).toHaveValue(readable?'MBL-CH-0201':'');
  if(!readable){
   await expect(page.getByRole('alert')).toHaveCount(1);await expect(page.getByText('Enter the Customer PO reference.',{exact:true})).toHaveCount(1);
   await page.getByRole('button',{name:'Preview IPO & PT',exact:true}).click();expect(previews).toHaveLength(0);
   await reference.fill('MBL-CH-CORRECTED');
  }
  if(!readable){const response=page.waitForResponse(r=>r.url().endsWith(`/${id}/sale-preview`));await page.getByRole('button',{name:'Preview IPO & PT',exact:true}).click();expect((await response).status()).toBe(200);}
  await expect(page.getByLabel('I reviewed the IPO and PT breakup for Accounts.',{exact:true})).toBeVisible();
  expect(previews.at(-1).invoiceTerms).toBe('completion');
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

test('UBL BESS Direct PO keeps the PO installation details separate from the saved branch', async ({page}) => {
  await actors(page.request);
  await login(page.request, 'coordinator-release@example.test');
  const fixture = JSON.parse(await readFile(`.local/e2e-fixture-${process.env.PZ_E2E_PORT ?? '3180'}.json`, 'utf8'));
  expect(fixture.marker).toBe('power-zone-disposable-browser-fixture-v1');
  expect(new URL(fixture.databaseUrl).hostname).toBe('127.0.0.1');
  const pool = new pg.Pool({connectionString: fixture.databaseUrl, max: 1});
  try {
    const framework = (await pool.query("SELECT id,customer_id FROM project_framework_current WHERE configuration_key='UBL-BESS-20-40'")).rows[0];
    const code = 'BESS-9876';
    const name = 'UBL BESS Direct PO fixture';
    const address = 'Installation address on customer PO, Lahore';
    const saved = (await pool.query(
      "INSERT INTO sites(id,customer_id,name,code,location,contact_person,contact_phone,region,status) VALUES ((SELECT MAX(id)+1 FROM sites),$1,$2,$3,'Registered branch address','Registered contact','03001111111','Central','Active') RETURNING *",
      [framework.customer_id, name, code],
    )).rows[0];
    await page.goto('/dashboard');
    await page.getByRole('navigation', {name:'Atif shortcuts'}).getByRole('button', {name:'Direct PO', exact:true}).click();
    await page.getByLabel('Accepted quotation', {exact:true}).selectOption(framework.id);
    const pdf = new jsPDF({compress:true});
    pdf.text(['Branch code: '+code.toLowerCase(), 'Branch name: '+name, 'Delivery address: '+address, 'POC: On Site Contact: 03002222222', 'Customer PO reference: BESS-PO-9876'], 16, 18);
    await page.locator('input[type=file]').setInputFiles({name:'ubl-bess-po.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdf.output('arraybuffer'))});
    await page.getByRole('button', {name:'Upload', exact:true}).click();
    await expect(page.getByLabel('Installation address', {exact:true})).toHaveValue(address);
    await page.getByLabel('Approval date', {exact:true}).fill('2026-11-08');
    await page.getByLabel('Invoice terms', {exact:true}).selectOption('completion');
    const stored = page.waitForResponse(r => r.url().endsWith('/actions') && r.request().postDataJSON()?.action === 'save-direct-po-details');
    await page.getByRole('region', {name:'PO details, please verify'}).getByRole('button', {name:'Review IPO', exact:true}).click();
    expect((await stored).ok()).toBe(true);
    await expect(page.getByRole('heading', {name:'Review IPO', exact:true})).toBeVisible();
    const record = (await pool.query('SELECT site_id,stage,data FROM project_workflow_records WHERE site_id=$1', [saved.id])).rows[0];
    expect(record.stage).toBe('po_receipt');
    expect(record.data.directPoDetails.values).toMatchObject({siteCode:code,siteAddress:address,siteContact:'On Site Contact'});
    expect((await pool.query('SELECT * FROM sites WHERE id=$1', [saved.id])).rows[0]).toEqual(saved);
    await expect(page.getByLabel('I reviewed the IPO and PT breakup for Accounts.', {exact:true})).toBeVisible();
    await page.getByRole('button', {name:'Edit record', exact:true}).click();
    await expect(page.getByLabel('Installation address', {exact:true})).toHaveValue(address);
    await page.getByRole('button', {name:'Cancel editing record', exact:true}).click();
    await page.getByLabel('I reviewed the IPO and PT breakup for Accounts.', {exact:true}).check();
    await page.getByLabel('Customer approved this exact quotation or pre-agreed configuration.', {exact:true}).check();
    page.once('dialog', d => d.accept());
    const issued = page.waitForResponse(r => r.url().endsWith('/actions') && r.request().postDataJSON()?.action === 'receipt');
    await page.getByRole('button', {name:'Confirm Sale & Issue', exact:true}).click();
    expect((await issued).ok()).toBe(true);
    const handoff = (await pool.query(
      "SELECT o.snapshot FROM operations_boq_issuances o JOIN project_workflow_records w ON o.snapshot->>'workflowRecordId'=w.id::text WHERE w.site_id=$1",
      [saved.id],
    )).rows[0];
    expect(handoff.snapshot.deliveryAddress).toBe(address);
    expect((await pool.query('SELECT * FROM sites WHERE id=$1', [saved.id])).rows[0]).toEqual(saved);
  } finally {
    await pool.end();
  }
});
