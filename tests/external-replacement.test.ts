import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {materialStockFixture} from './material-stock-fixture.js';
import {WarehouseAuthorityRepository,warehousePosition} from '../server/inventory/warehouse-ledger.js';
import {MaterialReplacementsRepository} from '../server/inventory/material-replacements.js';
import {MaterialStockRepository} from '../server/inventory/material-stock.js';
import {signDispatch,receiveSigned} from './signed-dispatch-fixture.js';
import {replacementCommittedPrintRecord,replacementDocumentPdf} from '../server/inventory/material-replacement-documents.js';
test('external original DO supports replacement, signed OUT and signed faulty return without inventing original dispatch',async()=>{
 const db=await testDatabase();try{
 const f=await materialStockFixture(db.pool,'CH-CBL-AC-16MM/4C-PK');
 await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[f.reviewer,f.owner]);
 await new WarehouseAuthorityRepository(db.pool).command(f.owner,{warehouse:'Lahore warehouse',version:0,sourceSha256:f.stockSha,state:'active',reason:'Isolated reviewed source',requestKey:randomUUID()});
 const repo=new MaterialReplacementsRepository(db.pool),input={externalOriginal:{reference:'EXTERNAL-DO-753',itemId:'CH-CBL-AC-16MM/4C-PK',unit:'m',quantity:'2',siteName:'External test site',customer:'UBL',ipo:'CHP-TEST'},warehouse:'Lahore warehouse',quantity:'1',expectedOriginalReturnQuantity:'1',originalSerial:null,reason:'Fictional warranty replacement',requestKey:randomUUID()};
 const opened=await repo.open(f.reviewer,input);assert.equal((await repo.open(f.reviewer,input)).id,opened.id);
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_material_dispatches')).rows[0].n,0);
 const detail=await repo.detail(f.reviewer,opened.id);assert.equal(detail.snapshot.original.dispatchId,null);assert.equal(detail.snapshot.original.number,'EXTERNAL-DO-753');
 await assert.rejects(repo.open(f.reviewer,{...input,quantity:'3',requestKey:randomUUID()}),/exceeds/);
 const outInput={caseId:opened.id,caseVersion:1,requestKey:randomUUID(),sourceSha256:f.stockSha,authorityVersion:1,quantity:'1',ledgerRevision:0,replacementSerial:null,reason:'Actual replacement dispatch',transport:{issuedTo:'Engineer',driver:'Driver',vehicle:'TEST',driverIdentity:''}};
 const out=await repo.issue(f.reviewer,outInput);assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))?.currentClosing,'7');
 const record=(await db.pool.query('SELECT * FROM inventory_material_replacement_dispatches WHERE id=$1',[out.id])).rows[0];
 const pdf=replacementDocumentPdf(replacementCommittedPrintRecord(record,'replacement-out'));assert(pdf.length<2_000_000);
 await signDispatch(db.pool,f.reviewer,'replacement-out',out.id);await signDispatch(db.pool,f.reviewer,'replacement-out',out.id);
 assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))?.currentClosing,'6');
 const evidence=await new MaterialStockRepository(db.pool).uploadEvidence(f.reviewer,{warehouse:'Lahore warehouse',filename:'faulty.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7 isolated faulty assessment').toString('base64')});
 const receipt=await receiveSigned(db.pool,repo,f.reviewer,{caseId:opened.id,caseVersion:2,requestKey:randomUUID(),warehouse:'Lahore warehouse',evidenceId:evidence.id,quantity:'1',receivedItemId:input.externalOriginal.itemId,receivedUnit:'m',receivedSerial:null,date:'2026-11-02',reason:'Counted actual faulty cable'});
 assert.equal((await repo.detail(f.reviewer,opened.id)).returns[0].heldQuantity,'1');
 assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))?.currentClosing,'6','Faulty custody is not usable stock');
 await repo.releaseUsable(f.reviewer,{returnId:receipt.id,caseVersion:3,requestKey:randomUUID(),sourceSha256:f.stockSha,authorityVersion:1,ledgerRevision:1,evidenceId:evidence.id,quantity:'1',usableConfirmed:true,itemIdentityConfirmed:true,reason:'Inspected as usable original cable'});
 assert.equal((await warehousePosition(db.pool,f.stockSha,f.key))?.currentClosing,'7');
 }finally{await db.close();}
});
