import {test} from 'node:test';import assert from 'node:assert/strict';
import {customerDocumentNativeIpo} from '../server/accounts/customer-document-identity.js';
const issued=[{id:'one',number:'CHP-163',orderNumber:'140/250',customerCode:'UBL',customerName:'United Bank Limited'},{id:'two',number:'CHP-163',orderNumber:'141/250',customerCode:'UBL',customerName:'United Bank Limited'},{id:'elahi',number:'CHP-350',orderNumber:'',customerCode:'ELEN',customerName:'Elahi Energy'}];
test('QC documents resolve exact customer plus issued IPO and UPS order, without name or shared-PO matching',()=>{
 assert.equal(customerDocumentNativeIpo({ipo:'CHP-163 · 140/250',customer:'UBL'},issued),'one');assert.equal(customerDocumentNativeIpo({ipo:'CHP-163 · 141/250',customer:'United Bank Limited'},issued),'two');assert.equal(customerDocumentNativeIpo({ipo:'CHP-350',customer:'Elahi Energy'},issued),'elahi');
 for(const site of [{ipo:'CHP-163',customer:'UBL'},{ipo:'CHP-163 · 142/250',customer:'UBL'},{ipo:'CHP-163 · 140/250',customer:'MBL'},{ipo:'CHP-350',customer:''}])assert.equal(customerDocumentNativeIpo(site,issued),undefined);
 assert.equal(customerDocumentNativeIpo({ipo:'CHP-163 · 140/250',customer:'UBL'},[...issued,{...issued[0],id:'duplicate'}]),undefined);
});
test('the live Accounts projection links imported UPS signatures to the correct immutable IPO without changing source records',async()=>{
 const {testDatabase}=await import('./database.js'),{randomUUID,createHash}=await import('node:crypto'),{customerDocuments}=await import('../server/accounts/customer-documents.js');const db=await testDatabase();try{
 const actor=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash)VALUES($1,'exact-document@example.test','Owner','Admin','fixture')",[actor]);
 const site=(await db.pool.query('SELECT id FROM sites LIMIT 1')).rows[0].id,draft=randomUUID(),boq=randomUUID(),rev=randomUUID(),po=randomUUID();
 await db.pool.query("INSERT INTO survey_drafts(id,owner_id,inputs)VALUES($1,$2,'{}')",[draft,actor]);await db.pool.query('INSERT INTO boqs(id,draft_id,site_id,customer_id,sequence,created_by)VALUES($1,$2,$3,1,99,$4)',[boq,draft,site,actor]);await db.pool.query("INSERT INTO boq_revisions(id,boq_id,revision,number,snapshot,created_by)VALUES($1,$2,0,'EXACT-UPS','{}',$3)",[rev,boq,actor]);await db.pool.query("INSERT INTO customer_purchase_orders(id,customer_id,po_number,input,created_by)VALUES($1,1,'SHARED-PO','{}',$2)",[po,actor]);
 const ipos=[randomUUID(),randomUUID()];
 for(const [n,id] of ipos.entries()){
 const order=(140+n)+'/250',orderPo=randomUUID(),board='registered-exact-'+order,file=randomUUID(),content=Buffer.from('%PDF-1.7\nExact original '+order);
 await db.pool.query("INSERT INTO customer_purchase_orders(id,customer_id,po_number,input,created_by)VALUES($1,1,$2,'{}',$3)",[orderPo,'SHARED-BATCH-'+n,actor]);
 await db.pool.query('INSERT INTO internal_purchase_orders(id,customer_po_id,number,snapshot,fingerprint,request_key,created_by)VALUES($1,$2,$3,$4,$5,$6,$7)',[id,orderPo,'CHP-163',{approvedCommercialSource:{key:'UBL-UPS-6-10'},customer:{shortCode:'UBL',name:'United Bank Limited'},input:{orderNumber:order},siteName:'Original approved name '+n,boqRevisionId:rev},'fixture-'+n,randomUUID(),actor]);
 await db.pool.query('INSERT INTO operations_board_sites(id,created_by)VALUES($1,$2)',[board,actor]);await db.pool.query("INSERT INTO operations_board_files(id,site_id,filename,media_type,sha256,content,created_by)VALUES($1,$2,'Signed DO.pdf','application/pdf',$3,$4,$5)",[file,board,createHash('sha256').update(content).digest('hex'),content,actor]);
 await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by)VALUES($1,1,$2,'QC','Exact original',$3,$4)",[board,{name:'Updated display name '+n,customer:'UBL',ipo:'CHP-163 · '+order,deliveries:[{signedDo:{id:file}}]},randomUUID(),actor]);
 }
 const rows=(await customerDocuments(db.pool)).rows;assert.equal(rows.length,2);for(const [n,id] of ipos.entries())assert.equal(rows.find(r=>r.ipo==='CHP-163 · '+(140+n)+'/250')?.jobKey,'ipo:'+id);
 assert.equal((await db.pool.query('SELECT count(*) n FROM inventory_material_source_links')).rows[0].n,'0');assert.equal((await db.pool.query('SELECT count(*) n FROM accounts_pt_entries')).rows[0].n,'0');assert.equal((await db.pool.query('SELECT count(*) n FROM inventory_warehouse_operational_movements')).rows[0].n,'0');
 }finally{await db.close();}
});
