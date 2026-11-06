import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {testDatabase} from './database.js';
import {accountsIpoLabel,withAccountsIpo} from '../shared/accounts-site-reference.js';
import {materialCostingQueue} from '../server/accounts/material-costing.js';
import {customerDocuments} from '../server/accounts/customer-documents.js';
import {siteEvidence} from '../server/accounts/site-evidence.js';

test('Accounts shows CHP-233 · 2/60 only for Consumer Hub Lahore saved as CHP-338 · 20/60',()=>{
 assert.equal(accountsIpoLabel('CHP-338 · 20/60','Consumer Hub Lahore'),'CHP-233 · 2/60');
 assert.equal(accountsIpoLabel(' CHP-338  ·  20/60 ','consumer hub lahore'),'CHP-233 · 2/60');
 assert.equal(accountsIpoLabel('CHP-338 · 20/60','Other site'),'CHP-338 · 20/60','another site with the same label is unchanged');
 assert.equal(accountsIpoLabel('CHP-338 · 19/60','Consumer Hub Lahore'),'CHP-338 · 19/60','another label is unchanged');
 const row={ipo:'CHP-338 · 20/60',site:'Consumer Hub Lahore',amount:'5'};
 assert.deepEqual(withAccountsIpo(row),{ipo:'CHP-233 · 2/60',site:'Consumer Hub Lahore',amount:'5',originalIpoLabel:'CHP-338 · 20/60'});
 assert.equal(row.ipo,'CHP-338 · 20/60','input not mutated');
});

test('Material Costing, Document Library and View Documents show the corrected reference; saved records keep theirs',async()=>{
 const db=await testDatabase();try{
  const admin=randomUUID(),accounts=randomUUID();
  for(const [id,role]of [[admin,'Admin'],[accounts,'Accounts']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);
  const site='consumer-hub-fixture',file=randomUUID(),content=Buffer.from('fixture-do');
  await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[site,admin]);
  await db.pool.query("INSERT INTO operations_board_files(id,site_id,filename,media_type,sha256,content,created_by) VALUES($1,$2,'Signed DO.pdf','application/pdf',$3,$4,$5)",[file,site,createHash('sha256').update(content).digest('hex'),content,admin]);
  const snapshot={name:'Consumer Hub Lahore',ipo:'CHP-338 · 20/60',customer:'Meezan Bank Limited',installation:true,stage:'delivered',documents:[],deliveries:[{deliveryDate:'2026-10-10',partial:false,signedDo:{id:file,name:'Signed DO.pdf',mediaType:'application/pdf'},materialPhoto:{id:file,name:'Signed DO.pdf',mediaType:'application/pdf'}}]};
  await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Test','Isolated fixture',$3,$4)",[site,snapshot,randomUUID(),admin]);
  assert.equal((await materialCostingQueue(db.pool,accounts)).rows.find((r:any)=>r.siteId===site)?.ipo,'CHP-233 · 2/60');
  assert.ok((await customerDocuments(db.pool)).rows.filter((r:any)=>r.siteId===site).every((r:any)=>r.ipo==='CHP-233 · 2/60'));
  assert.equal((await siteEvidence(db.pool,accounts,site)).site.ipo,'CHP-233 · 2/60');
  assert.equal((await db.pool.query('SELECT snapshot FROM operations_board_versions WHERE site_id=$1',[site])).rows[0].snapshot.ipo,'CHP-338 · 20/60','saved Operations record unchanged');
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_board_versions WHERE site_id=$1',[site])).rows[0].n,1,'no new version written');
 }finally{await db.close();}
});
