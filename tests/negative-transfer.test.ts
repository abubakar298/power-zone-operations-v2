import {signDispatch} from './signed-dispatch-fixture.js';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import express from 'express';
import request from 'supertest';
import {authHttp} from '../server/auth/http.js';
import {AuthService} from '../server/auth/service.js';
import {AuthRepository} from '../server/auth/repository.js';
import {digest} from '../server/auth/crypto.js';
import {readConfig} from '../server/config.js';
import {HttpError} from '../server/http/errors.js';
import {createApp} from '../server/app.js';
import {warehouseTransferHttp} from '../server/inventory/warehouse-transfer-http.js';
import {warehouseTransferPrintModel,warehouseTransferReceiptPrintModel} from '../server/inventory/warehouse-transfer-documents.js';
import {GatePassRepository} from '../server/inventory/gate-passes.js';
import {materialDraftHttp} from '../server/inventory/material-http.js';
import {MaterialDraftRepository} from '../server/inventory/material-drafts.js';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {testDatabase} from './database.js';
import {migrate} from '../server/db/migrate.js';
import {InventoryReviewRepository} from '../server/inventory/review-register.js';
import {WarehouseSourceRepository} from '../server/inventory/warehouse-register.js';
import {warehouseLedgerKey} from '../server/inventory/warehouse-source.js';
import {WarehouseAuthorityRepository,warehousePosition} from '../server/inventory/warehouse-ledger.js';
import {MaterialStockRepository} from '../server/inventory/material-stock.js';
import {WarehouseTransferRepository} from '../server/inventory/warehouse-transfers.js';

async function stagedDirectory(staged=true){const dir=await mkdtemp(join(tmpdir(),'pz-transfer-migrations-'));for(const name of await readdir(resolve('migrations')))if(/^\d+_[a-z_]+\.sql$/.test(name)&&Number(name.split('_')[0])<=130)await copyFile(resolve('migrations',name),join(dir,name));if(staged)for(const name of ['131_inventory_warehouse_transfers.sql','133_inventory_transfer_gate_copies.sql','142_inventory_signed_dispatch_posting.sql','152_inventory_unknown_closing_movements.sql'])await copyFile(resolve('migrations',name),join(dir,name));return dir;}
async function tableSnapshot(pool:any,names?:string[]){const tables=names??(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' ORDER BY tablename")).rows.map((r:any)=>r.tablename);const result:Record<string,unknown>={};for(const name of tables){const q='"'+name.replaceAll('"','""')+'"';result[name]=(await pool.query(`SELECT count(*)::text rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) digest FROM ${q} t`)).rows[0];}return result;}

test('negative-stock window permits transfer DO then signed source OUT below zero exactly once',async(t)=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-10-30T07:52:12.000Z'));
 const db=await testDatabase({skipMigrations:true}),legacy=await stagedDirectory(false),directory=await stagedDirectory();
 try{
  await migrate(db.pool,legacy);await db.pool.query("CREATE VIEW inventory_material_dispatches_active AS SELECT * FROM inventory_material_dispatches WHERE coalesce(snapshot->>'cancelled','false')<>'true'; CREATE VIEW inventory_material_dispatch_lines_active AS SELECT l.* FROM inventory_material_dispatch_lines l JOIN inventory_material_dispatches_active d ON d.id=l.dispatch_id");
  const ids=Object.fromEntries(['owner','source','destination','sourceKeeper','destinationKeeper','foreignKeeper','unassigned'].map(k=>[k,randomUUID()]));
  for(const [name,id] of Object.entries(ids))await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@transfer.invalid',name,name==='owner'?'Admin':'Inventory','isolated']);
  for(const [user,warehouse,capability]of [[ids.source,'Lahore warehouse','dispatcher'],[ids.destination,'Karachi warehouse','dispatcher'],[ids.sourceKeeper,'Lahore warehouse','storekeeper'],[ids.destinationKeeper,'Karachi warehouse','storekeeper'],[ids.foreignKeeper,'Multan warehouse','storekeeper']])await db.pool.query('INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,$2,$3,$4)',[user,warehouse,capability,ids.owner]);
  const item='CH-CBL-AC-16MM/4C-PK',reviewSha='a'.repeat(64),catalogueSha='b'.repeat(64),sourceSha='c'.repeat(64);
  const catalogue={rows:[{itemId:item}]},source={groups:[{id:'fictional-transfer',title:'Fictional transfer source',warehouse:'Lahore',rows:[{id:'cable',item:'Cable',itemId:item,unit:'m',origin:'warehouse_stock',status:'Review needed',dispatch:0,used:0,countedReturn:0,credited:0}]}]};
  const review=new InventoryReviewRepository(db.pool),warehouse=new WarehouseSourceRepository(db.pool);await review.importSource(ids.owner,{sourceSha256:reviewSha,catalogueSha256:catalogueSha,source,catalogue});
  const balance=(name:string,opening:number|null,unit='m')=>({itemId:item,warehouse:name,unit,description:'Fictional cable',opening,in:0,out:0,closing:opening,openingStatus:'Reviewed source',review:''});
  await warehouse.importSource(ids.owner,{sourceSha256:sourceSha,catalogueSha256:catalogueSha,reviewSourceSha256:reviewSha,finalItemIds:[item],source:{meta:{fictional:true},balances:[balance('Lahore warehouse',100),balance('Karachi warehouse',10),balance('Karachi warehouse',2,'coil'),balance('Multan warehouse',null),balance('Islamabad warehouse',-1)],events:[]}});
  const oldGates=new GatePassRepository(db.pool);assert.equal((await oldGates.list(ids.sourceKeeper)).records.length,0,'Old130 GatePasses remains available without transfer tables.');
  const before=await tableSnapshot(db.pool);await migrate(db.pool,directory,true);assert.deepEqual(await tableSnapshot(db.pool,Object.keys(before)),before,'131 preserves every preexisting table and row.');
  const beforeChoices=await tableSnapshot(db.pool),choiceApp=express();
  choiceApp.use('/api/warehouse-transfers',warehouseTransferHttp(db.pool,(req,_res,next)=>{req.authSession={user:{id:ids.source,email:'isolated@transfer.invalid',display_name:'source',role:'Inventory'},csrfToken:'isolated',tokenHash:'isolated',expiresAt:new Date(Date.now()+60000)};next();}));
  const choice=(await request(choiceApp).get('/api/warehouse-transfers/access').expect(200)).body;
  assert.deepEqual(choice.sourceWarehouses,['Lahore warehouse']);
  assert.deepEqual(choice.warehouses,['Islamabad warehouse','Karachi warehouse','Lahore warehouse','Multan warehouse'],'Known destinations remain selectable before warehouse authority activation.');
  assert.deepEqual(choice.receiptWarehouses,['Lahore warehouse'],'Listing a destination never grants its receiving permission.');
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_warehouse_authority_versions')).rows[0].n,0);
  assert.deepEqual(await tableSnapshot(db.pool,Object.keys(beforeChoices)),beforeChoices,'Destination selection only reads names; no activation, transfer, or stock mutation.');
  const authority=new WarehouseAuthorityRepository(db.pool);for(const name of ['Lahore warehouse','Karachi warehouse','Multan warehouse','Islamabad warehouse'])await authority.command(ids.owner,{warehouse:name,version:0,sourceSha256:sourceSha,state:'active',reason:'Fictional reviewed baseline',requestKey:randomUUID()});
  const repo=new WarehouseTransferRepository(db.pool),stock=new MaterialStockRepository(db.pool),fromKey=warehouseLedgerKey(item,'Lahore warehouse','m'),toKey=warehouseLedgerKey(item,'Karachi warehouse','m');
  const original=(await db.pool.query('SELECT * FROM inventory_warehouse_source_balances ORDER BY ledger_key')).rows;
  const intake=await repo.intake(ids.source,'Lahore warehouse','Karachi warehouse');assert.equal(intake.source.positions[0].currentClosing,'100');assert.ok(intake.destination.positions.every(p=>!('currentClosing' in p)),'Source-only dispatcher gets reviewed destination identities, not its stock totals.');await assert.rejects(repo.intake(ids.sourceKeeper,'Lahore warehouse','Karachi warehouse'),/dispatcher/);
  const issueSigned=async(actor:string,command:Parameters<WarehouseTransferRepository['issue']>[1])=>{const r=await repo.issue(actor,command);if(!r.stockPosted)await signDispatch(db.pool,actor,'transfer-out',r.id,command.source.warehouse);return {...r,stockPosted:true,awaitingSignedGate:false};};
  const input={requestKey:randomUUID(),source:{warehouse:'Lahore warehouse',sourceSha256:sourceSha,authorityVersion:1},destination:{warehouse:'Karachi warehouse',sourceSha256:sourceSha,authorityVersion:1},reason:'Fictional dispatch between warehouses',transport:{vehicle:'TEST-000',driver:'Fictional driver',reference:'TEST ONLY'},lines:[{lineKey:randomUUID(),itemId:item,sourceLedgerKey:fromKey,destinationLedgerKey:toKey,quantity:'8',sourceLedgerRevision:0,destinationLedgerRevision:0}]};
  await assert.rejects(issueSigned(ids.sourceKeeper,input),/dispatcher/);await assert.rejects(issueSigned(ids.destination,input),/dispatcher/);await assert.rejects(repo.list(ids.unassigned),/document access/);
  const command={...input,lines:[{...input.lines[0],quantity:'101'}]};const saved=await repo.issue(ids.source,command);assert.equal(saved.stockPosted,false);assert.equal((await warehousePosition(db.pool,sourceSha,fromKey))?.currentClosing,'100');
  await signDispatch(db.pool,ids.source,'transfer-out',saved.id,'Lahore warehouse');assert.equal((await warehousePosition(db.pool,sourceSha,fromKey))?.currentClosing,'-1');assert.equal((await warehousePosition(db.pool,sourceSha,toKey))?.currentClosing,'10');
  await signDispatch(db.pool,ids.source,'transfer-out',saved.id,'Lahore warehouse');assert.equal((await warehousePosition(db.pool,sourceSha,fromKey))?.currentClosing,'-1');
 }finally{await db.close();await rm(directory,{recursive:true,force:true});await rm(legacy,{recursive:true,force:true});}
});
