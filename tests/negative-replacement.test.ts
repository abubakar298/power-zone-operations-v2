import {signDispatch,receiveSigned} from './signed-dispatch-fixture.js';
import {test} from 'node:test';
import request from 'supertest';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import {digest} from '../server/auth/crypto.js';
import {replacementCommittedPrintRecord,replacementDocumentPdf} from '../server/inventory/material-replacement-documents.js';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile,readdir,mkdtemp,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {migrate} from '../server/db/migrate.js';
import {testDatabase} from './database.js';
import {materialStockFixture} from './material-stock-fixture.js';
import {warehouseLedgerKey} from '../server/inventory/warehouse-source.js';
import {WarehouseAuthorityRepository,warehousePosition} from '../server/inventory/warehouse-ledger.js';
import {MaterialStockRepository} from '../server/inventory/material-stock.js';
import {MaterialReplacementsRepository,replacementIssueInputSchema,replacementUsableInputSchema} from '../server/inventory/material-replacements.js';

async function staged(pool:any){for(const [table,file]of [['inventory_warehouse_transfers','131_inventory_warehouse_transfers.sql'],['inventory_material_replacement_cases','132_inventory_material_replacements.sql'],['inventory_temporary_documents','140_inventory_temporary_documents.sql'],['inventory_signed_dispatch_pending','142_inventory_signed_dispatch_posting.sql']])if(!(await pool.query('SELECT to_regclass($1) AS table',[table])).rows[0].table)await pool.query(await readFile('migrations/'+file,'utf8'));await pool.query(await readFile('migrations/135_inventory_replacement_gate_copies.sql','utf8'));}
async function originalDispatch(pool:any,f:any,quantity='2',unit='m',warehouse='Lahore warehouse',siteCount=1){
 const draftId=randomUUID(),id=randomUUID(),lineKey=randomUUID(),siteId=randomUUID(),snapshot={kind:'fixed',parent:false,warehouse,sites:[{siteId,ipo:'FICTIONAL-COMPLETED-IPO',siteName:'Fictional completed site',installation:true,status:'Completed',items:[{privateCost:'Must not be copied into replacement context'}]}],lines:[{key:lineKey,itemId:'FINAL',unit,description:'Fictional original cable',out:quantity,sites:[siteId]}],transport:{issuedTo:'Fictional engineer',driver:'Driver',vehicle:'TEST',driverIdentity:''}};
 if(siteCount>1){const extra=randomUUID();snapshot.sites.push({...snapshot.sites[0],siteId:extra,siteName:'Fictional second parent site'});snapshot.lines[0].sites.push(extra);}
 await pool.query('INSERT INTO inventory_material_drafts(id,created_by) VALUES($1,$2)',[draftId,f.reviewer]);
 await pool.query('INSERT INTO inventory_material_draft_versions(draft_id,version,snapshot,request_key,request_fingerprint,created_by) VALUES($1,1,$2,$3,$4,$5)',[draftId,snapshot,randomUUID(),'a'.repeat(64),f.reviewer]);
 await pool.query('INSERT INTO inventory_material_dispatches(id,number,draft_id,draft_version,source_sha256,warehouse,snapshot,request_key,request_fingerprint,created_by) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9)',[id,'FICTIONAL-ORIGINAL-'+id,draftId,f.stockSha,warehouse,snapshot,randomUUID(),'b'.repeat(64),f.reviewer]);
 await pool.query('INSERT INTO inventory_material_dispatch_lines(dispatch_id,line_key,source_sha256,ledger_key,item_id,unit,description,quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,lineKey,f.stockSha,f.key,'FINAL',unit,'Fictional original cable',quantity]);
 const p=await warehousePosition(pool,f.stockSha,f.key),after=String(Number(p!.currentClosing)-Number(quantity));
 await pool.query("INSERT INTO inventory_warehouse_operational_movements(id,source_sha256,ledger_key,ledger_revision,kind,draft_id,dispatch_id,line_key,in_delta,out_delta,closing_before,closing_after,created_by) VALUES($1,$2,$3,$4,'dispatch-out',$5,$6,$7,0,$8,$9,$10,$11)",[randomUUID(),f.stockSha,f.key,p!.ledgerRevision+1,draftId,id,lineKey,quantity,p!.currentClosing,after,f.reviewer]);
 return{id,draftId,lineKey,siteId,siteIds:snapshot.sites.map(s=>s.siteId)};
}
const transport={issuedTo:'Fictional engineer',driver:'Fictional driver',vehicle:'TEST',driverIdentity:''};

test('negative-stock window permits replacement OUT below zero and leaves faulty return separate',async(t)=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-10-30T07:52:12.000Z'));
 const db=await testDatabase();try{const f=await materialStockFixture(db.pool),original=await originalDispatch(db.pool,f,'7');await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by)VALUES($1,'Lahore warehouse','dispatcher',$2)",[f.reviewer,f.owner]);await new WarehouseAuthorityRepository(db.pool).command(f.owner,{warehouse:'Lahore warehouse',version:0,sourceSha256:f.stockSha,state:'active',reason:'Isolated reviewed source',requestKey:randomUUID()});
 const repo=new MaterialReplacementsRepository(db.pool),opened=await repo.open(f.reviewer,{originalDispatchId:original.id,originalLineKey:original.lineKey,warehouse:'Lahore warehouse',quantity:'1',expectedOriginalReturnQuantity:'1',originalSerial:null,reason:'Fictional replacement from exhausted source',requestKey:randomUUID()});
 const out=await repo.issue(f.reviewer,{caseId:opened.id,caseVersion:1,requestKey:randomUUID(),sourceSha256:f.stockSha,authorityVersion:1,quantity:'1',ledgerRevision:1,replacementSerial:null,reason:'Owner-authorized negative stock during reconciliation',transport});assert.equal(out.stockPosted,false);assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))?.currentClosing,'0');await signDispatch(db.pool,f.reviewer,'replacement-out',out.id);assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))?.currentClosing,'-1');await signDispatch(db.pool,f.reviewer,'replacement-out',out.id);assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))?.currentClosing,'-1');
 }finally{await db.close();}
});
