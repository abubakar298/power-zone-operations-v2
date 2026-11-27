import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {jsPDF} from 'jspdf';
import {actors,login} from './release-fixtures.js';

// Storekeeper Documents Upload: every listed document and every uploaded signed copy opens in a viewer
// inside the page (PDFs and images), with Download kept beside Preview. A file chosen for upload can be
// previewed before saving, and the bytes uploaded are exactly the chosen file.
function pdf(text:string){const doc=new jsPDF({compress:true});doc.setFontSize(28);doc.text(text,20,40);return Buffer.from(doc.output('arraybuffer'));}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const docx=Buffer.from('PK fictional word file');
const records=[
 {kind:'dispatch',id:'do-1',number:'DO-PREVIEW',warehouse:'Lahore warehouse',created_at:'2026-11-20T10:00:00Z',signed_copies:0,siteName:'Preview test site'},
 {kind:'purchase',id:'igp-1',number:'IGP-PREVIEW',warehouse:'Lahore warehouse',created_at:'2026-11-21T10:00:00Z',signed_copies:3},
];
const saved=[
 {id:'c1',copy_kind:'signed-store',source_site_id:null,evidence_id:'ev-pdf',note:'Signed PDF copy',created_at:'2026-11-21T11:00:00Z'},
 {id:'c2',copy_kind:'signed-store',source_site_id:null,evidence_id:'ev-png',note:'Photo of the signed copy',created_at:'2026-11-21T12:00:00Z'},
 {id:'c3',copy_kind:'signed-store',source_site_id:null,evidence_id:'ev-docx',note:'Other file type',created_at:'2026-11-21T13:00:00Z'},
];
const signedPreview=(page:Page)=>page.getByRole('dialog',{name:/^Signed store copy · 2026-11-21/});

test('storekeeper previews listed documents and signed copies in the page, and previews a chosen file before upload',async({page})=>{
 await actors(page.request);await login(page.request,'inventory-release@example.test');
 const copies=[...saved],uploads:{base64:string;mediaType:string;filename:string}[]=[];let copyWrites=0;
 const issued=pdf('Purchase IGP preview'),chosen=pdf('Chosen signed IGP');
 await page.route('**/api/material-dispatches/**',async r=>{const url=new URL(r.request().url()),path=url.pathname.replace('/api/material-dispatches','');
  if(path==='/access')return r.fulfill({json:{kind:'storekeeper',warehouses:['Lahore warehouse']}});
  if(path==='/gate-passes')return r.fulfill({json:{kind:'storekeeper',warehouses:['Lahore warehouse'],records,signoffs:[]}});
  if(path==='/gate-passes/purchase/igp-1')return r.fulfill({json:{copies,parent:false,documentRevision:1}});
  if(path==='/gate-passes/purchase/igp-1/document.pdf'||path==='/gate-passes/dispatch/do-1/document.pdf')return r.fulfill({contentType:'application/pdf',headers:{'Content-Disposition':'attachment; filename="Issued copy.pdf"'},body:issued});
  if(path==='/evidence/ev-pdf'||path==='/evidence/ev-new')return r.fulfill({contentType:'application/pdf',body:path.endsWith('new')?chosen:issued});
  if(path==='/evidence/ev-png')return r.fulfill({contentType:'image/png',body:png});
  if(path==='/evidence/ev-docx')return r.fulfill({contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',body:docx});
  if(path==='/evidence'&&r.request().method()==='POST'){uploads.push(r.request().postDataJSON());return r.fulfill({json:{id:'ev-new'}});}
  if(path==='/gate-pass-copies'){copyWrites++;copies.push({id:'c4',copy_kind:'signed-store',source_site_id:null,evidence_id:'ev-new',note:'Chosen file uploaded',created_at:'2026-11-22T09:00:00Z'});return r.fulfill({json:{}});}
  throw Error('Unexpected request '+path);
 });
 await page.goto('/inventory/gate-passes?bucket=dos');
 // The DO row keeps a Download button next to Preview.
 const doRow=page.locator('.inventory-upload-row').filter({hasText:'DO-PREVIEW'});
 await expect(doRow.getByRole('button',{name:'Preview DO',exact:true})).toBeVisible();
 const doDownload=page.waitForEvent('download');await doRow.getByRole('button',{name:'Download DO',exact:true}).click();
 expect((await readFile((await (await doDownload).path())!)).subarray(0,5).toString()).toBe('%PDF-');

 await page.getByTestId('document-bucket-purchases').click();
 const row=page.locator('.inventory-upload-row').filter({hasText:'IGP-PREVIEW'});
 await row.getByRole('button',{name:'Preview purchase IGP',exact:true}).click();
 const issuedPreview=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Document preview',exact:true})});
 await expect(issuedPreview.getByRole('img',{name:'IGP-PREVIEW · page 1',exact:true})).toBeVisible();
 await issuedPreview.getByRole('button',{name:'Close preview',exact:true}).click();
 await expect(row.getByRole('button',{name:'Download purchase IGP',exact:true})).toBeVisible();

 // Saved signed copies: PDF and photo open in the page; another file type says to use Download.
 await row.getByRole('button',{name:'Upload signed IGP',exact:true}).click();
 const list=row.getByTestId('signed-copy');await expect(list).toHaveCount(3);await row.screenshot({path:'test-results/storekeeper-signed-copies.png'});
 for(const copy of await list.all())await expect(copy.getByRole('button',{name:'Download',exact:true})).toBeVisible();
 await list.filter({hasText:'Signed PDF copy'}).getByRole('button',{name:/^Preview:/}).click();
 await expect(signedPreview(page).getByRole('img',{name:/page 1$/})).toBeVisible();
 await signedPreview(page).getByRole('button',{name:'Close record',exact:true}).click();
 await list.filter({hasText:'Photo of the signed copy'}).getByRole('button',{name:/^Preview:/}).click();
 await expect(signedPreview(page).locator('.ipo-preview-pages img')).toHaveAttribute('src',/^data:image\/png;base64,/);
 await signedPreview(page).getByRole('button',{name:'Close record',exact:true}).click();
 await list.filter({hasText:'Other file type'}).getByRole('button',{name:/^Preview:/}).click();
 await expect(signedPreview(page).getByText('This file type cannot be previewed here. Use Download to open it.',{exact:true})).toBeVisible();
 await expect(signedPreview(page).getByRole('button',{name:'Download',exact:true})).toBeVisible();
 await signedPreview(page).getByRole('button',{name:'Close record',exact:true}).click();

 // Before upload: preview the chosen file without uploading anything.
 await row.getByLabel('Signed file',{exact:true}).setInputFiles({name:'signed-igp.pdf',mimeType:'application/pdf',buffer:chosen});
 await expect(row.getByText('Chosen: signed-igp.pdf',{exact:true})).toBeVisible();
 await row.getByRole('button',{name:'Preview chosen file: signed-igp.pdf',exact:true}).click();
 const chosenPreview=page.getByRole('dialog',{name:'signed-igp.pdf',exact:true});
 await expect(chosenPreview.getByText('Chosen file · not uploaded yet',{exact:true})).toBeVisible();
 await expect(chosenPreview.getByRole('img',{name:'signed-igp.pdf · page 1',exact:true})).toBeVisible();
 await expect(chosenPreview.getByRole('button',{name:'Download',exact:true})).toHaveCount(0);
 await chosenPreview.getByRole('button',{name:'Close record',exact:true}).click();
 expect(uploads).toHaveLength(0);

 // After upload: the saved file is the chosen file, byte for byte, and it can be previewed in the list.
 await row.getByRole('button',{name:'Save uploaded copy',exact:true}).click();
 await expect(page.getByText('Signed store copy saved.',{exact:true})).toBeVisible();
 expect(copyWrites).toBe(1);expect(uploads).toHaveLength(1);
 expect(Buffer.from(uploads[0].base64,'base64').equals(chosen)).toBe(true);expect(uploads[0].mediaType).toBe('application/pdf');
 await expect(list).toHaveCount(4);
 await list.filter({hasText:'Chosen file uploaded'}).getByRole('button',{name:/^Preview:/}).click();
 await expect(page.getByRole('dialog',{name:/^Signed store copy · 2026-11-22/}).getByRole('img',{name:/page 1$/})).toBeVisible();
 await page.screenshot({path:'test-results/storekeeper-document-preview.png',fullPage:true});
});

test('storekeeper chosen photo is previewed before upload',async({page})=>{
 await actors(page.request);await login(page.request,'inventory-release@example.test');
 await page.route('**/api/material-dispatches/**',async r=>{const path=new URL(r.request().url()).pathname.replace('/api/material-dispatches','');
  if(path==='/access')return r.fulfill({json:{kind:'storekeeper',warehouses:['Lahore warehouse']}});
  if(path==='/gate-passes')return r.fulfill({json:{kind:'storekeeper',warehouses:['Lahore warehouse'],records,signoffs:[]}});
  if(path==='/gate-passes/dispatch/do-1')return r.fulfill({json:{copies:[],parent:false,documentRevision:1}});
  throw Error('Unexpected request '+path);
 });
 await page.goto('/inventory/gate-passes?bucket=dos');
 const row=page.locator('.inventory-upload-row').filter({hasText:'DO-PREVIEW'});
 await row.getByRole('button',{name:'Upload signed copy',exact:true}).click();
 await row.getByLabel('Signed file',{exact:true}).setInputFiles({name:'gate-photo.png',mimeType:'image/png',buffer:png});
 await row.getByRole('button',{name:'Preview chosen file: gate-photo.png',exact:true}).click();
 const preview=page.getByRole('dialog',{name:'gate-photo.png',exact:true});
 await expect(preview.getByRole('img',{name:'gate-photo.png',exact:true})).toHaveAttribute('src',/^data:image\/png;base64,/);
});
