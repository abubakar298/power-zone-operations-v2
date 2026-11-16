import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {jsPDF} from 'jspdf';
import {actors,login} from './release-fixtures.js';

// Fix 6 (16 Nov 2026): a PDF preview shows page 1 straight away, draws later pages only when the user
// scrolls near them, and Download reuses the file the preview already loaded.
function pages(count:number){const pdf=new jsPDF();for(let n=1;n<=count;n++){if(n>1)pdf.addPage();pdf.setFontSize(40);pdf.text(`Page ${n}`,40,60);}return Buffer.from(pdf.output('arraybuffer'));}
const title='Approved Quotation Preview';
const drawn=(page:Page)=>page.locator('.ipo-preview-pages img[data-drawn]').count();

async function openTwelvePagePreview(page:Page,siteName:string,siteCode:string){
 await actors(page.request);const coordinator=await login(page.request,'coordinator-release@example.test');
 const savedResponse=await page.request.post('/api/cni',{headers:coordinator,data:{customerId:3,siteName,siteCode,quantity:1,presentation:'Inclusive',discount:'0'}});expect(savedResponse.ok(),await savedResponse.text()).toBe(true);const saved=await savedResponse.json();
 const admin=await login(page.request);expect((await page.request.post(`/api/cni/${saved.id}/review`,{headers:admin,data:{versionId:saved.versionId,action:'Approved',remarks:'Disposable browser approval'}})).ok()).toBe(true);
 await login(page.request,'coordinator-release@example.test');
 const document=pages(12);const requests={count:0};
 await page.route('**/proposal.pdf',route=>{requests.count++;return route.fulfill({status:200,contentType:'application/pdf',headers:{'Content-Disposition':'attachment; filename="Long preview.pdf"'},body:document});});
 await page.goto('/dashboard');
 await page.getByRole('button',{name:/^Ready to Send/}).click();
 await page.getByRole('row').filter({hasText:siteName}).getByRole('button',{name:'Review',exact:true}).click();
 await expect(page.getByRole('img',{name:`${title} · page 1`,exact:true})).toBeVisible();
 return requests;
}

test('a long PDF preview shows page 1 first and draws later pages only when scrolled to',async({page})=>{
 await openTwelvePagePreview(page,'Long preview pages','LP01');
 await expect(page.locator('.ipo-preview-pages img')).toHaveCount(12);
 await page.waitForTimeout(1000);
 const early=await drawn(page);
 expect(early).toBeGreaterThanOrEqual(1);expect(early).toBeLessThan(12);
 await page.locator('.ipo-preview-pages').screenshot({path:'test-results/document-preview-start.png'});
 await expect(page.getByRole('img',{name:`${title} · page 12`,exact:true})).not.toHaveAttribute('data-drawn');
 // Scrolling to the end draws the last page.
 await page.locator('.ipo-preview-pages').evaluate(element=>{element.scrollTop=element.scrollHeight;});
 await expect(page.getByRole('img',{name:`${title} · page 12`,exact:true})).toHaveAttribute('src',/^data:image\/png/);
 await page.locator('.ipo-preview-pages').evaluate(element=>{const last=element.querySelector<HTMLElement>('img[data-page="12"]')!;element.scrollTop+=last.getBoundingClientRect().top-element.getBoundingClientRect().top;});
 await page.locator('.ipo-preview-pages').screenshot({path:'test-results/document-preview-end.png'});
});

test('Download reuses the file the preview already loaded',async({page})=>{
 const requests=await openTwelvePagePreview(page,'Long preview download','LP02');
 expect(requests.count).toBe(1);
 const downloaded=page.waitForEvent('download');
 await page.getByRole('region',{name:title,exact:true}).getByRole('button',{name:'Download',exact:true}).click();
 const file=await downloaded;
 expect(file.suggestedFilename()).toBe('Long preview.pdf');
 expect((await readFile((await file.path())!)).subarray(0,5).toString()).toBe('%PDF-');
 expect(requests.count).toBe(1);
});
