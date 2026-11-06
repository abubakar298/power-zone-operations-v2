import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {MaterialDraftRepository} from '../server/inventory/material-drafts.js';
test('approved temporary copies and saved transport are scoped, versioned, retry-safe and non-posting',async()=>{
 const db=await testDatabase();try{
  const owner=randomUUID(),inventory=randomUUID(),other=randomUUID();
  for(const [id,role]of [[owner,'Admin'],[inventory,'Inventory'],[other,'Inventory']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash)VALUES($1,$2,$3,$4,$5)',[id,id+'@test.invalid',role,role,'test-only']);
  for(const [id,warehouse]of [[inventory,'Lahore warehouse'],[other,'Karachi warehouse']])await db.pool.query('INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by)VALUES($1,$2,$3,$4)',[id,warehouse,'dispatcher',owner]);
  const repo=new MaterialDraftRepository(db.pool),input={requestKey:randomUUID(),id:'',version:0,type:'OGP',date:'2026-10-29',warehouse:'Lahore warehouse',party:'Fictional test site',sourceReference:'Test IPO',actualReference:'',notes:'Tracking only',detailsConfirmed:false,lines:[{itemId:'TEST',description:'Temporary count',quantity:'2',unit:'piece',remarks:''}]};
  const saved=await repo.saveTemporaryDocument(inventory,input);assert.match(saved.number,/^TMP-OGP-20261029-\d{4}$/);assert.equal(saved.version,1);
  assert.equal((await repo.saveTemporaryDocument(inventory,input)).id,saved.id);
  await assert.rejects(repo.saveTemporaryDocument(inventory,{...input,party:'Changed retry'}),/already used/);
  await assert.rejects(repo.saveTemporaryDocument(other,input),/outside/);
  const next={...input,id:saved.id,version:1,requestKey:randomUUID(),actualReference:'FINAL-TEST',detailsConfirmed:true};
  assert.equal((await repo.saveTemporaryDocument(inventory,next)).version,2);
  await assert.rejects(repo.saveTemporaryDocument(inventory,{...next,requestKey:randomUUID()}),/changed/);
  assert.equal((await repo.temporaryDocuments(other)).documents.length,0);assert.equal((await repo.temporaryDocuments(inventory)).documents.length,1);
  assert.equal((await db.pool.query('SELECT count(*) FROM inventory_temporary_document_versions')).rows[0].count,'2');
  await repo.saveTransportChoice(inventory,{warehouse:'Lahore warehouse',kind:'driver',value:'Fictional driver',details:'TEST-ID'});
  assert.equal((await repo.transportChoices(inventory,'Lahore warehouse')).choices[0].details,'TEST-ID');
  await assert.rejects(repo.transportChoices(other,'Lahore warehouse'),/outside/);
  assert.equal((await db.pool.query('SELECT count(*) FROM inventory_material_dispatches')).rows[0].count,'0');
 }finally{await db.close();}
});
test('Parent DO shortages require management and closure blocks further postings',async()=>{
 const db=await testDatabase();try{
  const {ParentReconciliationRepository}=await import('../server/inventory/parent-reconciliation.js'),{requireOpenParent}=await import('../server/inventory/parent-open.js');
  const owner=randomUUID(),inventory=randomUUID(),outside=randomUUID(),draft=randomUUID(),site=randomUUID();
  for(const [id,role]of [[owner,'Management'],[inventory,'Inventory'],[outside,'Inventory']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash)VALUES($1,$2,$3,$4,$5)',[id,id+'@test.invalid',role,role,'test-only']);
  for(const [id,warehouse]of [[inventory,'Lahore warehouse'],[outside,'Karachi warehouse']])await db.pool.query('INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by)VALUES($1,$2,$3,$4)',[id,warehouse,'dispatcher',owner]);
  await db.pool.query('INSERT INTO inventory_material_drafts(id,created_by)VALUES($1,$2)',[draft,inventory]);
  const snapshot={warehouse:'Lahore warehouse',kind:'variable',parent:true,sites:[{siteId:site,ipo:'TEST-IPO',siteName:'Fictional site',installation:true,items:[]}],lines:[],transport:{issuedTo:'Test',vehicle:'',driver:'',driverIdentity:''}};
  await db.pool.query('INSERT INTO inventory_material_draft_versions(draft_id,version,snapshot,request_key,request_fingerprint,created_by)VALUES($1,1,$2,$3,$4,$5)',[draft,snapshot,randomUUID(),'a'.repeat(64),inventory]);
  const repo=new ParentReconciliationRepository(db.pool),base={id:draft,version:0,draftVersion:1,action:'close',reason:'Evidence is pending',requestKey:randomUUID()};
  await assert.rejects(repo.change(inventory,base),/still unresolved/);await assert.rejects(repo.read(outside,draft),/outside/);
  assert.equal((await repo.change(inventory,{...base,action:'review',requestKey:randomUUID()})).status,'management-review');
  await assert.rejects(repo.change(inventory,{...base,version:1,action:'accept-variance',requestKey:randomUUID()}),/Management/);
  const accept={...base,version:1,action:'accept-variance',reason:'Management accepts recorded discrepancy without stock credit',requestKey:randomUUID()};
  assert.equal((await repo.change(owner,accept)).status,'closed');assert.equal((await repo.change(owner,accept)).status,'closed');
  await assert.rejects(requireOpenParent(db.pool,draft),/closed/);assert.equal((await db.pool.query('SELECT count(*) FROM inventory_warehouse_operational_movements')).rows[0].count,'0');
 }finally{await db.close();}
});
