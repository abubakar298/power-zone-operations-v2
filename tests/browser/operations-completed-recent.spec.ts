import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
test('completed jobs show ten latest actual completions and search includes older sites',async({page})=>{
 await actors(page.request);await login(page.request);
 const sites=Array.from({length:13},(_,i)=>({id:'complete-'+i,name:'Completed fixture '+String(i).padStart(2,'0'),ipo:'CHP-'+i,stage:'delivered',installation:true,completed:true,projectType:'ups',operationsTeam:'central',qcJob:{date:'2026-10-'+String(i+1).padStart(2,'0')},dispatchDate:'2026-11-'+String(20-i).padStart(2,'0'),documents:[],history:[],accounts:[],blockers:[],version:1}));
 await page.route('**/api/operations-board/sites',r=>r.fulfill({json:{sites,access:{kind:'owner',team:null,name:'Owner'}}}));
 await page.route('**/api/operations-board/vendors',r=>r.fulfill({json:{vendors:[]}}));
 await page.goto('/operations/sites');
 await page.getByRole('button',{name:/13 Completed Work complete/}).click();
 const table=page.locator('.ob-table');await expect(table.locator('tbody tr')).toHaveCount(10);await expect(table.locator('tbody tr').first()).toContainText('Completed fixture 12');await expect(table.locator('tbody tr').first()).toContainText('13 Oct 2026');await expect(table.locator('tbody tr').last()).toContainText('Completed fixture 03');await expect(page.getByText('Showing 10 of 13 sites',{exact:true})).toBeVisible();
 const pager=page.getByRole('navigation',{name:'sites pages'});await pager.getByRole('button',{name:'Next'}).click();await expect(table.locator('tbody tr')).toHaveCount(3);await expect(table).toContainText('Completed fixture 00');await expect(pager.getByRole('button',{name:'Next'})).toBeDisabled();
 await page.getByRole('searchbox',{name:'Search site, IPO or customer PO'}).fill('Completed fixture 00');await expect(table.locator('tbody tr')).toHaveCount(1);await expect(table).toContainText('Completed fixture 00');await page.getByRole('searchbox').fill('');await expect(table.locator('tbody tr')).toHaveCount(10);
 await page.screenshot({path:'test-results/operations-completed-recent.png',fullPage:true});
});
