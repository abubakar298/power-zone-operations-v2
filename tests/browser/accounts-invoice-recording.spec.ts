import {test,expect} from '@playwright/test';import {readFile} from 'node:fs/promises';import {randomUUID,createHash} from 'node:crypto';import pg from 'pg';import {actors,login} from './release-fixtures.js';import {AccountsSourceRegisters} from '../../server/accounts/source-registers.js';
test('Accounts reviews delivered/completed documents and persists PT invoice reference, date and notes without posting balances',async({page})=>{
 await actors(page.request);const headers=await login(page.request,'accounts-release@example.test');
 const fixture=JSON.parse(await readFile(`.local/e2e-fixture-${process.env.PZ_E2E_PORT??'3180'}.json`,'utf8'));
 expect(fixture.marker).toBe('power-zone-disposable-browser-fixture-v1');expect(new URL(fixture.databaseUrl).hostname).toBe('127.0.0.1');
 const pool=new pg.Pool({connectionString:fixture.databaseUrl,max:3});
 const delivered='invoice-browser-delivered',completed='invoice-browser-completed';
 try{
 const admin=(await pool.query("SELECT id FROM users WHERE email='admin@example.test'")).rows[0].id;
 await new AccountsSourceRegisters(pool).import(admin,{sourceDate:'2026-10-29',manifest:[{name:'Disposable invoice fixture',sha256:'a'.repeat(64)}],registers:[{rows:[{key:'UBL:UPS:source-import',site:'Existing source invoice fixture',ipo:'CHP-1',kind:'UPS',program:'UBL UPS 250',installed:true,singleInvoiceSubmitted:true,singlePaymentReceived:true,invoiceReferences:['27-19999']},{key:'UBL:SOLAR:advance-import',site:'Existing advance invoice fixture',ipo:'CHP-70',kind:'Solar / BESS',program:'Solar 70',delivered:true,installed:false,advance:{invoiceAmount:'500',submitted:true,received:true},completion:{invoiceAmount:null},invoiceReferences:['27-29999']}]}],cables:{rows:[]},internet:{rows:[]},sites:{rows:[]},evidence:{rows:[],cableStageAdjustments:[]}},0);
 for(const [id,name,installation,type,fileName]of [[delivered,'Delivered invoice fixture',false,'delivery-only','Signed DO.pdf'],[completed,'Completed invoice fixture',true,'ups','IRR and sign-off.pdf'],['registered-UBL:UPS:source-import','Existing source invoice fixture',true,'ups','Existing signed DO.pdf'],['registered-UBL:SOLAR:advance-import','Existing advance invoice fixture',true,'solar-bess','Existing advance DO.pdf']] as const){
 await pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[id,admin]);
 const file=randomUUID(),content=Buffer.from('%PDF-1.4\n%%EOF\n'+id),hash=createHash('sha256').update(content).digest('hex');
 await pool.query("INSERT INTO operations_board_files(id,site_id,filename,media_type,sha256,content,created_by) VALUES($1,$2,$3,'application/pdf',$4,$5,$6)",[file,id,fileName,hash,content,admin]);
 const snapshot={id,name,ipo:'IPO-'+id,operationsTeam:'central',installation,projectType:type,invoiceOnDelivery:type==='solar-bess',stage:'delivered',completed:id!=='registered-UBL:SOLAR:advance-import',deliveryDate:'2026-10-28',documents:[{id:id+'-doc',label:fileName,location:'Submitted to Accounts',date:'2026-10-29',evidence:[{id:file,name:fileName,mediaType:'application/pdf',sha256:hash}]}]};
 await pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Source imported','Isolated saved fixture',$3,$4)",[id,snapshot,randomUUID(),admin]);
 }
 await page.goto('/accounts/invoicing');
 await expect(page.getByRole('heading',{name:'Delivery Invoices',exact:true})).toBeVisible();
 await page.getByRole('row').filter({hasText:'Delivered invoice fixture'}).getByRole('button',{name:'Review',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByText('Submitted to Accounts',{exact:false})).toBeVisible();
 const download=page.waitForEvent('download');await dialog.getByRole('link',{name:'Signed DO.pdf',exact:true}).click();const downloaded=await download;expect(await downloaded.failure()).toBeNull();expect((await readFile((await downloaded.path())!,'utf8'))).toContain(delivered);
 await dialog.getByRole('button',{name:'Record invoice',exact:true}).click();
 await dialog.getByLabel('PT invoice reference',{exact:true}).fill('PT-E2E-100');await dialog.getByLabel('Invoice date',{exact:true}).fill('2026-10-29');await dialog.getByLabel('Notes',{exact:true}).fill('Recorded in PT; signed document reviewed.');
 await dialog.getByRole('button',{name:'Save invoice record',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'PT invoice reference recorded.'})).toBeVisible();
 await page.reload();await page.locator('summary').filter({hasText:'Recorded PT invoices'}).click();await expect(page.getByRole('cell',{name:/PT-E2E-100/})).toBeVisible();await expect(page.getByText('Recorded in PT; signed document reviewed.',{exact:true})).toBeVisible();await expect(page.getByRole('cell',{name:/27-19999/})).toBeVisible();await expect(page.getByRole('cell',{name:/27-29999/})).toBeVisible();await expect(page.getByText(/site records linked to existing invoice references/)).toBeVisible();
 expect((await page.request.post('/api/accounts-workspace/invoice-entries',{headers,data:{sourceKind:'Operations',siteKey:delivered,sourceVersion:1,milestone:'delivery',ptReference:'DUPLICATE',entryDate:'2026-10-29',notes:'',requestKey:randomUUID()}})).status()).toBe(409);
 await page.getByRole('button',{name:/Completed · Not Yet Invoiced/}).click();await page.getByRole('row').filter({hasText:'Completed invoice fixture'}).getByRole('button',{name:'Review',exact:true}).click();await expect(page.getByRole('dialog').getByRole('link',{name:'IRR and sign-off.pdf',exact:true})).toBeVisible();
 await page.screenshot({path:'test-results/accounts-invoice-documents.png',fullPage:true});
 await page.getByRole('dialog').getByRole('button',{name:'Record invoice',exact:true}).click();await page.getByLabel('PT invoice reference',{exact:true}).fill('PT-E2E-101');await page.getByLabel('Notes',{exact:true}).fill('Completion invoice entered in PT.');await page.getByRole('button',{name:'Save invoice record',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'PT invoice reference recorded.'})).toBeVisible();
 expect((await pool.query('SELECT count(*)::int n FROM accounts_invoice_entries')).rows[0].n).toBe(2);
 for(const table of ['internal_purchase_orders','stock_on_hand_entries','accounts_job_closures'])expect((await pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n).toBe(0);
 await page.screenshot({path:'test-results/accounts-invoice-recorded.png',fullPage:true});
 await login(page.request,'management-release@example.test');await page.goto('/dashboard');
 await page.getByRole('button',{name:'View as',exact:true}).click();await page.getByRole('navigation',{name:'View department workspace'}).getByRole('button',{name:'Accounts',exact:true}).click();
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Invoicing',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Delivery Invoices',exact:true})).toBeVisible();
 await page.locator('summary').filter({hasText:'Recorded PT invoices'}).click();await expect(page.getByRole('cell',{name:/PT-E2E-101/})).toBeVisible();
 await page.screenshot({path:'test-results/management-current-accounts.png',fullPage:true});
 await page.getByRole('button',{name:'View as',exact:true}).click();await page.getByRole('navigation',{name:'View department workspace'}).getByRole('button',{name:'Management',exact:true}).click();
 await page.getByRole('button',{name:'View as',exact:true}).click();await page.getByRole('navigation',{name:'View department workspace'}).getByRole('button',{name:'Procurement',exact:true}).click();
 await expect(page.getByRole('button',{name:'Power Zone — Dashboard',exact:true})).toContainText('Procurement');
 await expect(page.getByRole('navigation',{name:'Main',exact:true}).getByRole('button',{name:/^POs received/})).toBeVisible();
 await page.reload();await expect(page.getByRole('button',{name:'Power Zone — Dashboard',exact:true})).toContainText('Procurement');
 expect((await(await page.request.get('/api/auth/session')).json()).user.role).toBe('Management');
 await page.getByRole('button',{name:'View as',exact:true}).click();await page.getByRole('navigation',{name:'View department workspace'}).getByRole('button',{name:'Management',exact:true}).click();await expect(page.getByRole('button',{name:'View as',exact:true})).toBeVisible();
 }finally{await pool.end();}
});
