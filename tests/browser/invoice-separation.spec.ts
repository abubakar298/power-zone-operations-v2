import {test,expect} from '@playwright/test';import {readFile} from 'node:fs/promises';import pg from 'pg';
import {actors,login} from './release-fixtures.js';import {AccountsSourceRegisters} from '../../server/accounts/source-registers.js';
test('Missa invoice numbers and stages are individual rows, Internet remains28600 and83 credit stays separate',async({page})=>{
 await actors(page.request);await login(page.request,'accounts-release@example.test');const fixture=JSON.parse(await readFile(`.local/e2e-fixture-${process.env.PZ_E2E_PORT??'3180'}.json`,'utf8'));expect(fixture.marker).toBe('power-zone-disposable-browser-fixture-v1');expect(new URL(fixture.databaseUrl).hostname).toBe('127.0.0.1');const pool=new pg.Pool({connectionString:fixture.databaseUrl,max:2});
 try{
  const admin=(await pool.query("SELECT id FROM users WHERE email='admin@example.test'")).rows[0].id;
  const site={key:'UBL:SOLAR:287',customer:'UBL',kind:'Solar / BESS',program:'Solar 70',site:'Missa Kaswal',ipo:'CHP-287',po:'POF262701883',invoiceReferences:['27-10313-4/70','27-10313-S-4/70'],advance:{invoiceAmount:'2878377',received:true,submitted:true,submissionEvidence:'2026-08-19'},completion:{invoiceAmount:'2777524',received:true,submitted:true,submissionEvidence:'2026-10-21'}};
  const parts=[['advance','27-10313-4/70','2263213'],['advance','27-10313-S-4/70','615164'],['completion','27-10313-4/70','2133843'],['completion','27-10313-S-4/70','615164']].map(([stage,invoice,amount])=>({sourceKey:site.key,stage,invoice,amount}));
  const source=new AccountsSourceRegisters(pool);await source.import(admin,{sourceDate:'2026-10-31',manifest:[{name:'Isolated invoice split',sha256:'f'.repeat(64)}],registers:[{rows:[site]}],sites:{rows:[]},cables:{rows:[]},internet:{rows:[{key:'27-50105',invoice:'27-50105',ipo:site.ipo,site:site.site,amount:'28600',pendingAmount:'28600',submission:'Submitted',submissionDate:'2026-10-21',notes:'Internet remains unpaid'}]},evidence:{rows:[],cableStageAdjustments:[],invoiceComponents:parts,unallocatedCredits:[{key:'credit-test',sourceKey:site.key,site:site.site,customer:'United Bank Limited',amount:'83',status:'Excess system receipt · not allocated to Internet'}]}},0);
  const original=(await pool.query('SELECT snapshot FROM accounts_source_registers')).rows;
  await page.goto('/dashboard#workspace=finance&accountsTab=Payments+to+Record');await page.getByLabel('Search invoice, IPO, site or customer',{exact:true}).fill('Missa');
  await expect(page.getByRole('row').filter({hasText:'27-50105'})).toContainText('28,600');await expect(page.getByRole('row').filter({hasText:'27-10313'})).toHaveCount(0);
  await page.getByRole('button',{name:/^All invoices/}).click();const rows=page.locator('.accounts-list-panel').first().locator('tbody tr');await expect(rows).toHaveCount(5);
  await expect(rows.filter({hasText:'27-10313-S-4/70'})).toHaveCount(2);await expect(rows.filter({hasText:'50% Advance Invoice'})).toHaveCount(2);await expect(rows.filter({hasText:'Balance Invoice'})).toHaveCount(2);await expect(rows.filter({hasText:'Internet Invoice'})).toHaveCount(1);
  await expect(page.getByText(/27-10253/)).toHaveCount(0);await expect(rows.filter({hasText:'28,517'})).toHaveCount(0);
  await page.locator('summary').filter({hasText:'Unallocated customer credits'}).click();await expect(page.getByRole('row').filter({hasText:'Excess system receipt'})).toContainText('83');
  expect((await pool.query('SELECT snapshot FROM accounts_source_registers')).rows).toEqual(original);for(const table of ['accounts_invoice_receipts','accounts_payment_records'])expect((await pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n).toBe(0);
  await page.screenshot({path:'test-results/missa-individual-invoices.png',fullPage:true});
 }finally{await pool.end();}
});
