import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {testDatabase} from './database.js';
import {materialStockFixture} from './material-stock-fixture.js';
import {MaterialDraftRepository} from '../server/inventory/material-drafts.js';
import {temporaryDocumentPdf} from '../server/inventory/temporary-document-pdf.js';
async function pages(bytes:Buffer){const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});try{const pdf=await task.promise,output:string[]=[];for(let n=1;n<=pdf.numPages;n++)output.push((await(await pdf.getPage(n)).getTextContent()).items.map((i:any)=>i.str??'').join(' '));return output;}finally{await task.destroy();}}
const doc={number:'TMP-IGP-20261102-0002',type:'IGP' as const,date:'2026-11-02',warehouse:'Lahore warehouse',party:'Fixture branch',sourceReference:'CHP-TEST',actualReference:'IGP-190',notes:'Replacement',detailsConfirmed:false,lines:[{itemId:'CH-PCS-TEST',description:'Fixture hybrid inverter',quantity:'1',unit:'piece',remarks:'Faulty'},{itemId:'',description:'',quantity:'',unit:'',remarks:''}]};

test('a temporary document prints as an A4 inventory document with header, SR#, details, signatures and footer',async()=>{
 const text=await pages(temporaryDocumentPdf(doc));
 assert.equal(text.length,1);const page=text[0];
 for(const expected of [/Inwards Gate Pass/,/TEMPORARY - CONFIRM DETAILS/,/TMP-IGP-20261102-0002/,/Warehouse: Lahore warehouse/,/Date: 2026-11-02/,/Fixture branch/,/CHP-TEST/,/IGP-190/,/SR#/,/CH-PCS-TEST/,/Fixture hybrid inverter/,/Faulty/,/Notes: Replacement/,/No stock movement is posted/,/Received by storekeeper/,/Verified by Inventory/,/Page 1 of 1/])assert.match(page,expected);
 assert.doesNotMatch(page,/ID pending/,'blank lines are not printed');
 assert.match((await pages(temporaryDocumentPdf({...doc,type:'OGP',detailsConfirmed:true})))[0],/Outwards Gate Pass.*TEMPORARY - ACTUAL DETAILS CONFIRMED|TEMPORARY - ACTUAL DETAILS CONFIRMED.*Outwards Gate Pass/);
 const long=await pages(temporaryDocumentPdf({...doc,lines:Array.from({length:60},(_,i)=>({itemId:'CH-'+i,description:'Long fixture description '.repeat(4),quantity:String(i+1),unit:'piece',remarks:'Checked'}))}));
 assert.ok(long.length>1);long.forEach((p,i)=>{assert.match(p,/Inwards Gate Pass/);assert.match(p,new RegExp(`Page ${i+1} of ${long.length}`));assert.match(p,/Received by storekeeper/);});
});

test('only users with access to the warehouse can open a temporary document for printing',async()=>{
 const db=await testDatabase();try{
  const f=await materialStockFixture(db.pool),repo=new MaterialDraftRepository(db.pool),keeper=randomUUID(),other=randomUUID();
  for(const [id,warehouse]of [[keeper,'Lahore warehouse'],[other,'Karachi warehouse']]){await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash)VALUES($1,$2,$3,$4,$5)',[id,id+'@keeper.example.test','Keeper','Inventory','isolated']);await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by)VALUES($1,$2,'storekeeper',$3)",[id,warehouse,f.owner]);}
  const saved=await repo.saveTemporaryDocument(keeper,{requestKey:randomUUID(),id:'',version:0,type:'IGP',date:'2026-11-02',warehouse:'Lahore warehouse',party:'Fixture branch',sourceReference:'',actualReference:'',notes:'',detailsConfirmed:false,lines:[{itemId:'FINAL',description:'Fixture item',quantity:'1',unit:'piece',remarks:''}]});
  assert.equal((await repo.temporaryDocument(keeper,saved.id)).number,saved.number);
  await assert.rejects(repo.temporaryDocument(other,saved.id),/not found/);
  await assert.rejects(repo.temporaryDocument(keeper,randomUUID()),/not found/);
 }finally{await db.close();}
});
