import {jsPDF} from 'jspdf';import {test,expect} from '@playwright/test';import {readFile} from 'node:fs/promises';import {randomUUID,createHash} from 'node:crypto';import pg from 'pg';import {actors,login} from './release-fixtures.js';import {AccountsSourceRegisters} from '../../server/accounts/source-registers.js';
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
 const file=randomUUID(),pdf=new jsPDF();pdf.text(id,20,20);const content=Buffer.from(pdf.output('arraybuffer')),hash=createHash('sha256').update(content).digest('hex');
 await pool.query("INSERT INTO operations_board_files(id,site_id,filename,media_type,sha256,content,created_by) VALUES($1,$2,$3,'application/pdf',$4,$5,$6)",[file,id,fileName,hash,content,admin]);
 const snapshot={id,name,ipo:'IPO-'+id,operationsTeam:'central',installation,projectType:type,invoiceOnDelivery:type==='solar-bess',stage:'delivered',completed:id!=='registered-UBL:SOLAR:advance-import',deliveryDate:'2026-10-28',documents:[{id:id+'-doc',label:fileName,location:'Submitted to Accounts',date:'2026-10-29',evidence:[{id:file,name:fileName,mediaType:'application/pdf',sha256:hash}]}]};
 await pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Source imported','Isolated saved fixture',$3,$4)",[id,snapshot,randomUUID(),admin]);
 }
 await page.goto('/accounts/invoicing');
 await expect(page.getByRole('heading',{name:'Delivery milestone invoices',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/^Delivery-only/}).click();
 await page.getByRole('row').filter({hasText:'Delivered invoice fixture'}).getByRole('button',{name:'Record invoice',exact:true}).click();
 const dialog=page.getByRole('dialog').filter({hasText:'Invoice review'});await expect(dialog.getByText('Handed over to Accounts',{exact:false})).toBeVisible();
 await dialog.getByRole('button',{name:'View Documents',exact:true}).click();const documents=page.getByRole('dialog').filter({hasText:'Site documents'});await expect(documents.getByRole('heading',{name:'Signed DOs',exact:true})).toBeVisible();
 const fileResponse=page.waitForResponse(r=>r.request().method()==='GET'&&(r.headers()['content-type']??'').startsWith('application/pdf'));await documents.getByRole('button',{name:'Preview Signed DO.pdf',exact:true}).click();const response=await fileResponse;expect(response.ok()).toBe(true);const preview=page.getByRole('dialog',{name:'Signed DO.pdf',exact:true});await expect(preview.locator('.ipo-document-preview img')).toHaveCount(1);const original=await page.request.get(response.url());expect((await original.body()).toString('utf8')).toContain(delivered);await preview.getByRole('button',{name:'Close record',exact:true}).click();
 const download=page.waitForEvent('download');await documents.getByRole('button',{name:'Download',exact:true}).click();expect((await download).suggestedFilename()).toBe('Signed DO.pdf');
 await documents.getByRole('button',{name:'Close record',exact:true}).click();
 await dialog.getByRole('button',{name:'Record invoice',exact:true}).click();
 await dialog.getByLabel('PT invoice number',{exact:true}).fill('PT-E2E-100');await dialog.getByLabel('Invoice amount · PKR',{exact:true}).fill('125000');await dialog.getByLabel('Invoice date',{exact:true}).fill('2026-10-29');await dialog.getByLabel('Notes',{exact:true}).fill('Recorded in PT; signed document reviewed.');
 await dialog.getByRole('button',{name:'Save invoice',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Invoice PT-E2E-100 recorded.'})).toBeVisible();
 await expect(dialog.getByRole('row').filter({hasText:'PT-E2E-100'}).getByText('Created — not submitted',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Add another invoice',exact:true}).click();await dialog.getByLabel('PT invoice number',{exact:true}).fill('PT-E2E-100-S');await dialog.getByLabel('Description (for example Solar Panels)',{exact:true}).fill('Solar Panels');await dialog.getByRole('button',{name:'Save invoice',exact:true}).click();
 await expect(dialog.getByRole('row').filter({hasText:'PT-E2E-100-S'}).getByText('Amount not recorded',{exact:true})).toBeVisible();
 await dialog.getByRole('row').filter({hasText:'PT-E2E-100-S'}).getByRole('button',{name:'Delay reason',exact:true}).click();await dialog.getByLabel('Why is submission delayed?',{exact:true}).selectOption('physical-originals');await dialog.getByRole('button',{name:'Save delay reason',exact:true}).click();
 await expect(dialog.getByText('Delay: Awaiting physical originals',{exact:true})).toBeVisible();
 await page.screenshot({path:'test-results/accounts-separate-invoices.png',fullPage:true});
 await dialog.getByRole('button',{name:'Close record',exact:true}).click();
 await expect(page.getByRole('row').filter({hasText:'Delivered invoice fixture'}).getByText('2 of 2 invoices not submitted',{exact:true})).toBeVisible();
 await page.reload();await page.locator('summary').filter({hasText:'Recorded PT invoices'}).click();await expect(page.getByRole('cell',{name:/PT-E2E-100-S/})).toBeVisible();await expect(page.getByRole('cell',{name:/PT-E2E-100(?!-S)/})).toBeVisible();await expect(page.getByText('Recorded in PT; signed document reviewed.',{exact:true})).toBeVisible();await expect(page.getByRole('cell',{name:/27-19999/})).toBeVisible();await expect(page.getByRole('cell',{name:/27-29999/})).toBeVisible();await expect(page.getByText(/site records linked to existing invoice references/)).toBeVisible();
 // Distinct references above are valid for one site; reusing an existing reference must conflict.
 expect((await page.request.post('/api/accounts-workspace/invoice-entries',{headers,data:{sourceKind:'Operations',siteKey:delivered,sourceVersion:1,milestone:'delivery',ptReference:'PT-E2E-100',entryDate:'2026-10-29',notes:'',requestKey:randomUUID()}})).status()).toBe(409);
 await page.getByRole('button',{name:/^Installation \/ completion/}).click();await page.getByRole('row').filter({hasText:'Completed invoice fixture'}).getByRole('button',{name:'View Documents',exact:true}).click();await expect(page.getByRole('dialog').filter({hasText:'Site documents'}).getByRole('cell',{name:/IRR and sign-off.pdf/}).first()).toBeVisible();await page.getByRole('dialog').filter({hasText:'Site documents'}).getByRole('button',{name:'Close record',exact:true}).click();
 await page.getByRole('row').filter({hasText:'Completed invoice fixture'}).getByRole('button',{name:'Record invoice',exact:true}).click();
 await page.screenshot({path:'test-results/accounts-invoice-documents.png',fullPage:true});
 await page.getByRole('dialog').getByRole('button',{name:'Record invoice',exact:true}).click();await page.getByLabel('PT invoice number',{exact:true}).fill('PT-E2E-101');await page.getByLabel('Notes',{exact:true}).fill('Completion invoice entered in PT.');await page.getByRole('button',{name:'Save invoice',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Invoice PT-E2E-101 recorded.'})).toBeVisible();
 expect((await pool.query('SELECT count(*)::int n FROM accounts_invoice_entries')).rows[0].n).toBe(3);
 for(const table of ['accounts_invoice_submissions','accounts_invoice_receipts','accounts_payment_records'])expect((await pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n).toBe(0);
 for(const table of ['internal_purchase_orders','stock_on_hand_entries','accounts_job_closures'])expect((await pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n).toBe(0);
 await page.screenshot({path:'test-results/accounts-invoice-recorded.png',fullPage:true});
 await login(page.request,'management-release@example.test');await page.goto('/dashboard');
 await page.getByRole('button',{name:'View as',exact:true}).click();await page.getByRole('navigation',{name:'View department workspace'}).getByRole('button',{name:'Accounts',exact:true}).click();
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Dashboard',exact:true}).click();
 await page.getByRole('button',{name:/Invoices to Submit/}).click();
 await expect(page.getByRole('heading',{name:'Delivery milestone invoices',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/^Delivery-only/}).click();
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
