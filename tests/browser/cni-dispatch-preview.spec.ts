import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {actors,login,seedQuote} from './release-fixtures.js';

// WebKit honours upgrade-insecure-requests on loopback; this disposable HTTP fixture has no TLS.
// Keep production CSP unchanged and remove only that directive from fixture HTML responses.
test.beforeEach(async({page,browserName})=>{if(browserName==='webkit')await page.route('**/dashboard*',async route=>{const response=await route.fetch();const headers={...response.headers()};if(headers['content-security-policy'])headers['content-security-policy']=headers['content-security-policy'].replace(/upgrade-insecure-requests;?\s*/g,'');await route.fulfill({response,headers});});});

test('approved CNI review exposes saved-version dispatch evidence and records send separately from approval',async({page})=>{
 await actors(page.request);const coordinator=await login(page.request,'coordinator-release@example.test');
 const savedResponse=await page.request.post('/api/cni',{headers:coordinator,data:{customerId:3,siteName:'CNI dispatch regression',siteCode:'CD01',quantity:1,presentation:'Inclusive',discount:'0'}});expect(savedResponse.ok(),await savedResponse.text()).toBe(true);const saved=await savedResponse.json();
 const admin=await login(page.request);expect((await page.request.post(`/api/cni/${saved.id}/review`,{headers:admin,data:{versionId:saved.versionId,action:'Approved',remarks:'Disposable browser approval'}})).ok()).toBe(true);
 await login(page.request,'coordinator-release@example.test');await page.goto('/dashboard');
 await page.getByRole('button',{name:/^Ready to Send/}).click();
 await page.getByRole('row').filter({hasText:'CNI dispatch regression'}).getByRole('button',{name:'Review',exact:true}).click();
 const form=page.getByRole('region',{name:'Dispatch Approved Quotation',exact:true});await expect(form).toBeVisible();
 await expect(page.getByRole('img',{name:/Approved Quotation Preview · page 1/})).toBeVisible();
 const before=await page.request.get(`/api/coordinator/dispatch?cniVersionId=${saved.versionId}`);expect((await before.json()).record).toBeNull();
 await form.getByLabel('Sent to',{exact:true}).selectOption('Salesperson');await form.getByLabel('Recipient and delivery details',{exact:true}).fill('Regression salesperson — approved PDF handed over');
 const pdf=await page.request.get(`/api/cni/${saved.id}/versions/${saved.versionId}/proposal.pdf`);expect(pdf.ok()).toBe(true);
 await form.getByLabel('Dispatch evidence',{exact:true}).setInputFiles({name:'Dispatch confirmation.pdf',mimeType:'application/pdf',buffer:await pdf.body()});
 await form.getByRole('button',{name:'Upload Dispatch Evidence',exact:true}).click();await expect(form.getByText('Dispatch confirmation.pdf',{exact:true})).toBeVisible();
 await form.getByLabel('I have sent this approved version to the selected recipient.').check();
 await page.screenshot({path:'test-results/cni-dispatch-ready.png',fullPage:true});
 await form.getByRole('button',{name:'Dispatch Approved Quotation',exact:true}).click();await expect(form.getByRole('status')).toContainText('Marked sent to Salesperson');
 const record=(await(await page.request.get(`/api/coordinator/dispatch?cniVersionId=${saved.versionId}`)).json()).record;expect(record.cni_version_id).toBe(saved.versionId);
 const detail=await(await page.request.get(`/api/cni/${saved.id}`)).json();expect(detail.versions).toHaveLength(1);expect(detail.versions[0].snapshot).toEqual(saved.snapshot);
 await page.goto('/dashboard#workspace=dashboard&page=PO+%2F+Confirmation+Receipt');
 await expect(page.getByRole('heading',{name:'Customer Follow-up',exact:true,level:2})).toBeVisible();
 const row=page.getByRole('row').filter({hasText:'CNI dispatch regression'});
 await expect(row.getByRole('button',{name:'Confirm Sale',exact:true})).toBeDisabled();
 await row.getByRole('button',{name:'Review',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Quotation Summary',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Back to Customer Follow-up',exact:true}).click();
 await row.getByRole('button',{name:'Revise',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Revision Settings',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Save & send for approval',exact:true})).toBeEnabled();
 await expect(page.getByLabel('Site / Project name',{exact:true})).toHaveValue('CNI dispatch regression');
});

test('quotation PDF renders when newer JavaScript Promise helpers are unavailable and still downloads unchanged',async({page})=>{
 await actors(page.request);const headers=await login(page.request,'coordinator-release@example.test');const {quote}=await seedQuote(page.request,headers,'PDF-COMPAT',true);
 await page.addInitScript(()=>{Object.defineProperty(Promise,'try',{value:undefined,configurable:true,writable:true});Object.defineProperty(Promise,'withResolvers',{value:undefined,configurable:true,writable:true});});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/dashboard');await page.getByRole('button',{name:/^Management Review/}).click();await page.getByRole('row').filter({hasText:quote.number}).getByRole('button',{name:'Review',exact:true}).click();
 await expect(page.locator('.quotation-pdf-pages canvas').first()).toBeVisible();await expect(page.getByText(/undefined is not a function/)).toHaveCount(0);
 const before=(await(await page.request.get(`/api/commercial/quotations/${quote.id}`)).json()).snapshot;const downloaded=page.waitForEvent('download');await page.getByRole('link',{name:'Download PDF for Sharing',exact:true}).click();expect((await readFile((await(await downloaded).path())!)).subarray(0,5).toString()).toBe('%PDF-');expect((await(await page.request.get(`/api/commercial/quotations/${quote.id}`)).json()).snapshot).toEqual(before);
 expect(errors).toEqual([]);await page.screenshot({path:'test-results/quotation-pdf-compatible.png',fullPage:true});
});

test('quotation content remains readable when its PDF renderer fails, without changing approval or the quote',async({page})=>{
 await actors(page.request);const headers=await login(page.request,'coordinator-release@example.test');const {quote}=await seedQuote(page.request,headers,'PDF-FALLBACK',true);
 const before=(await(await page.request.get(`/api/commercial/quotations/${quote.id}`)).json()).snapshot;
 await page.route('**/assets/pdf-*.js',route=>route.abort('failed'));
 await page.goto('/dashboard');await page.getByRole('button',{name:/^Management Review/}).click();await page.getByRole('row').filter({hasText:quote.number}).getByRole('button',{name:'Review',exact:true}).click();
 const fallback=page.getByRole('article',{name:'Quotation content preview'});await expect(fallback).toBeVisible();await expect(fallback).toContainText(before.siteName);await expect(fallback.getByRole('columnheader',{name:'SR#',exact:true})).toBeVisible();await expect(fallback.getByRole('row')).not.toHaveCount(1);await expect(page.getByText(/undefined is not a function/)).toHaveCount(0);expect(await fallback.innerText()).not.toMatch(/Budgeted cost|Buying rate|Internal markup/);
 expect((await(await page.request.get(`/api/commercial/quotations/${quote.id}/quotation.pdf`)).body()).subarray(0,5).toString()).toBe('%PDF-');
 expect((await(await page.request.get(`/api/commercial/quotations/${quote.id}`)).json()).snapshot).toEqual(before);await page.screenshot({path:'test-results/quotation-readable-fallback.png',fullPage:true});
});
