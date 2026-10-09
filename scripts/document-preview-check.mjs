// Read-only preview/download verification with disposable API fixtures.
import {chromium} from '@playwright/test';
import {strict as assert} from 'node:assert';
import {jsPDF} from 'jspdf';
const browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const session={user:{id:'fixture',displayName:'Preview Fixture',role:'Coordinator',email:'fixture@example.invalid'},csrfToken:'fixture',expiresAt:'2030-01-01'};
const pdf=new jsPDF();pdf.text('Saved document fixture',20,20);const bytes=Buffer.from(pdf.output('arraybuffer'));
const fixtures={'/auth/status':{setupRequired:false},'/auth/session':session,'/dashboard':{user:session.user},'/notifications':{notifications:[],unreadCount:0},'/notifications/preferences':{email_enabled:true},'/coordinator':{tasks:[],stageCounts:{}},'/masters':{customers:[],sites:[]},'/boqs':{boqs:[{id:'boq',number:'BOQ-R1',customer:'Sample',site:'HQ'}]},'/boqs/drafts':{drafts:[{id:'draft',inputs:{customerId:1,siteName:'Unfinished survey',panelQty:10},review_status:'Draft'}]},'/commercial/quotations':{quotations:[{id:'quote',number:'QT-R1',customer:'Sample',site:'HQ'}]},'/commercial/quotations/quote':{workflow_status:'Approved'},'/orders':{orders:[{id:'ipo',number:'IPO-1',customer:'Sample',quotation_number:'QT-R1'}]},'/cni':{proposals:[{id:'cni',version_id:'v2',number:'CNI-R2',snapshot:{customer:{name:'Sample'},siteName:'HQ'},action:'Approved'}]}};
const requests=[];let deny=false;
await page.route('**/api/**',route=>{const request=route.request();assert.equal(request.method(),'GET');const path=new URL(request.url()).pathname.replace('/api','');requests.push(path);if(path.endsWith('.pdf'))return deny?route.fulfill({status:403,json:{message:'Access denied'}}):route.fulfill({contentType:'application/pdf',body:bytes});return route.fulfill({json:fixtures[path]??{}})});
await page.goto('http://127.0.0.1:5178');await page.getByRole('button',{name:'Documents',exact:true}).click();await page.getByRole('heading',{name:'Document library'}).waitFor();
for(const number of ['BOQ-R1','QT-R1','IPO-1','CNI-R2','Unfinished survey']){
 const row=page.getByRole('row').filter({has:page.getByRole('cell',{name:number,exact:true})});await row.getByRole('button',{name:'Preview',exact:true}).click();await page.getByRole('heading',{name:'Document preview'}).waitFor();await page.getByRole('img').first().waitFor();
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download PDF',exact:true}).click()]);assert.ok(download.suggestedFilename().endsWith('.pdf'));await page.getByRole('button',{name:'Back to documents',exact:true}).click();
}
assert.ok(requests.includes('/cni/cni/versions/v2/proposal.pdf'));assert.ok(requests.includes('/boqs/boq/costing.pdf'));assert.ok(requests.includes('/orders/ipo/ipo.pdf'));
deny=true;await page.getByRole('row').filter({has:page.getByRole('cell',{name:'BOQ-R1',exact:true})}).getByRole('button',{name:'Preview',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Download PDF',exact:true}).isDisabled(),true);assert.deepEqual(errors,[]);await browser.close();console.log('PASS: five saved document types preview/download; exact C&I version; read-only requests; denied access blocks download; no runtime errors.');
