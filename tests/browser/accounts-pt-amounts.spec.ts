import {test,expect} from '@playwright/test';import {readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';import pg from 'pg';
import {actors,login} from './release-fixtures.js';import {AccountsSourceRegisters} from '../../server/accounts/source-registers.js';
test('Accounts confirms a submitted university invoice amount without recording a payment',async({page})=>{
 await actors(page.request);await login(page.request,'accounts-release@example.test');const fixture=JSON.parse(await readFile(`.local/e2e-fixture-${process.env.PZ_E2E_PORT??'3180'}.json`,'utf8'));expect(fixture.marker).toBe('power-zone-disposable-browser-fixture-v1');expect(new URL(fixture.databaseUrl).hostname).toBe('127.0.0.1');const pool=new pg.Pool({connectionString:fixture.databaseUrl,max:2});
 try{
  const admin=(await pool.query("SELECT id FROM users WHERE email='admin@example.test'")).rows[0].id;
  await new AccountsSourceRegisters(pool).import(admin,{sourceDate:'2026-10-30',manifest:[{name:'Isolated invoice amount',sha256:'e'.repeat(64)}],registers:[{rows:[]}],sites:{rows:[]},cables:{rows:[]},internet:{rows:[]},evidence:{rows:[],cableStageAdjustments:[]}},0);
  const id=randomUUID(),snapshot={customer:'Iqra University',site:'Iqra University Test',ipo:'IPO-TEST',po:'PO-TEST',billingIds:[],invoiceReferences:['PT-TEST-IQRA'],sourceKey:'iqra-test'};
  await pool.query("INSERT INTO accounts_invoice_submissions(id,source_kind,site_key,source_key,source_version,milestone,invoice_reference,submitted_on,snapshot,request,request_key,created_by) VALUES($1,'Operations','iqra-test','iqra-test',1,'completion','PT-TEST-IQRA','2026-10-20',$2,'{}',$3,$4)",[id,snapshot,randomUUID(),admin]);
  await page.goto('/dashboard#workspace=finance&accountsTab=Payments+to+Record');
  const row=page.getByRole('row').filter({hasText:'PT-TEST-IQRA'});await row.getByRole('button',{name:'Confirm PT amounts',exact:true}).click();const dialog=page.getByRole('dialog');
  await expect(dialog.getByLabel('Transaction ID',{exact:true})).toHaveCount(0);await expect(dialog.getByLabel('Payment date',{exact:true})).toHaveCount(0);
  await dialog.getByLabel('Invoice amount from PT · PKR',{exact:true}).fill('10000');await dialog.getByLabel('Current outstanding from PT · PKR',{exact:true}).fill('10000');await dialog.getByLabel('PT confirmation note',{exact:true}).fill('PT checked; no payment received');
  await dialog.getByRole('button',{name:'Save PT amounts',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'No payment was recorded.'})).toBeVisible();
  await page.reload();await expect(row).toContainText('10,000');await expect(row.getByRole('button',{name:'Record payment',exact:true})).toBeEnabled();
  for(const table of ['accounts_invoice_receipts','accounts_payment_records'])expect((await pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n).toBe(0);
  expect((await pool.query('SELECT count(*)::int n FROM accounts_invoice_corrections')).rows[0].n).toBe(1);
  await page.screenshot({path:'test-results/iqra-invoice-amount-confirmed.png',fullPage:true});
 }finally{await pool.end();}
});
