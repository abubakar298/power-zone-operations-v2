import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import request from 'supertest';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import {digest} from '../server/auth/crypto.js';
import {testDatabase} from './database.js';
import {InventoryReviewRepository} from '../server/inventory/review-register.js';

test('historical reconciliation decisions preserve conclusions, require assigned approval, reject stale writes and never replay stock',async()=>{
 const db=await testDatabase();try{
  const ids:Record<string,string>={};
  for(const [name,role] of Object.entries({owner:'Management',inventory:'Inventory',store:'Inventory',otherManager:'Management',qc:'Operations'})){
   ids[name]=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[ids[name],name.toLowerCase()+'@example.test',name,role,'isolated']);
  }
  for(const [name,capability] of [['owner','approver'],['inventory','reviewer']])await db.pool.query('INSERT INTO inventory_review_access(user_id,capability,granted_by,reason) VALUES($1,$2,$3,$4)',[ids[name],capability,ids.owner,'Isolated review fixture']);
  const repo=new InventoryReviewRepository(db.pool);
  const row=(id:string,status:string,itemId='FINAL')=>({id,itemId,item:'Cable',unit:'m',origin:'warehouse_stock',status,dispatch:10,used:8,countedReturn:2,credited:2});
  const input={sourceSha256:'a'.repeat(64),catalogueSha256:'b'.repeat(64),source:{groups:[{id:'pool',title:'Pool',warehouse:'Lahore',rows:[row('verified','Reconciled — credit posted'),row('pending','Evidence needs review'),row('unknown','ID needs review','')]}]},catalogue:{rows:[{itemId:'FINAL'}]}};
  await assert.rejects(repo.importSource(ids.inventory,input),/Management must import/);
  assert.deepEqual(await repo.importSource(ids.owner,input),{imported:3,retained:0,stockPosted:0});
  assert.deepEqual(await repo.importSource(ids.owner,input),{imported:0,retained:3,stockPosted:0});
  await assert.rejects(repo.list(ids.store),/not assigned/);await assert.rejects(repo.list(ids.qc),/not assigned/);
  const list=await repo.list(ids.inventory),pending=list.rows.find(r=>r.source_row.sourceRowId==='pending')!,verified=list.rows.find(r=>r.state==='source-verified')!,unknown=list.rows.find(r=>r.source_row.sourceRowId==='unknown')!;
  assert.equal(list.postingEnabled,true);assert.equal(list.access.approver,false);
  const proposal={treatment:'verify-return' as const,explanation:'Check signed warehouse receipt.',evidence:[{reference:'Receipt 1',description:'Reviewed test receipt.'}]};
  const command={version:1,requestKey:randomUUID(),action:'propose' as const,reason:'Inventory reviewed the discrepancy.',proposal};
  await assert.rejects(repo.command(ids.owner,pending.id,command),/Only the assigned Inventory/);
  await assert.rejects(repo.command(ids.inventory,verified.id,command),/already verified/);
  assert.deepEqual(await repo.command(ids.inventory,pending.id,command),{version:2,state:'proposed',stockPosted:0});
  assert.deepEqual(await repo.command(ids.inventory,pending.id,command),{version:2,state:'proposed',stockPosted:0});
  await assert.rejects(repo.command(ids.inventory,pending.id,{...command,reason:'Changed reason using same key'}),/request key/);
  const approve={version:2,requestKey:randomUUID(),action:'approve' as const,reason:'Owner checked the receipt.'};
  await assert.rejects(repo.command(ids.otherManager,pending.id,approve),/assigned Management approver/);
  await assert.rejects(repo.command(ids.inventory,pending.id,approve),/assigned Management approver/);
  await assert.rejects(repo.command(ids.owner,pending.id,{...approve,version:1}),/changed/);
  const decision=await repo.command(ids.owner,pending.id,{...approve,action:'return-for-clarification',reason:'Confirm original stock entry first.'});
  assert.equal(decision.state,'clarification');
  await repo.command(ids.inventory,pending.id,{...command,version:3,requestKey:randomUUID()});
  const results=await Promise.allSettled([repo.command(ids.owner,pending.id,{...approve,version:4,requestKey:randomUUID()}),repo.command(ids.owner,pending.id,{...approve,version:4,requestKey:randomUUID()})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  const final=await repo.detail(ids.owner,pending.id);assert.equal(final.state,'approved-awaiting-posting');assert.equal(final.history.length,5);assert.deepEqual(final.history[0].proposal,proposal);
  await repo.command(ids.inventory,unknown.id,{...command,requestKey:randomUUID()});
  await assert.rejects(repo.command(ids.owner,unknown.id,{...approve,requestKey:randomUUID()}),/final item identity/);
  await assert.rejects(db.pool.query('DELETE FROM inventory_review_versions WHERE case_id=$1',[pending.id]));
  const revised=structuredClone(input);revised.source.groups[0].rows.push(row('new','Needs review'));revised.source.groups[0].rows[0].used=9;revised.sourceSha256='c'.repeat(64);
  await assert.rejects(repo.importSource(ids.owner,revised),/row changed/);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_review_sources')).rows[0].n,1);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM stock_on_hand_entries')).rows[0].n,0);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_review_cases')).rows[0].n,3);
  const origin='http://localhost:3000',app=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:origin,DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'inventory-review-isolated-test-token'}));
  const sessions:Record<string,{cookie:string;csrf:string}>={};
  for(const name of Object.keys(ids)){const token=randomBytes(32).toString('base64url'),csrf=randomUUID();await db.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),ids[name],csrf]);sessions[name]={cookie:'pz_session='+token,csrf};}
  await request(app).get('/api/inventory-reviews').expect(401);
  const get=(name:string,path='/api/inventory-reviews')=>request(app).get(path).set('Cookie',sessions[name].cookie);
  await get('store').expect(403);await get('qc').expect(403);
  const read=await get('inventory').expect(200);assert.equal(read.body.rows.length,3);assert.match(read.headers['cache-control'],/no-store/);
  const path='/api/inventory-reviews/'+pending.id+'/decisions';
  await request(app).post(path).set('Cookie',sessions.owner.cookie).set('Origin',origin).send(approve).expect(403);
  await request(app).post(path).set('Cookie',sessions.owner.cookie).set('Origin','https://untrusted.example').set('X-CSRF-Token',sessions.owner.csrf).send(approve).expect(403);
  await request(app).post(path).set('Cookie',sessions.store.cookie).set('Origin',origin).set('X-CSRF-Token',sessions.store.csrf).send(command).expect(403);
  await get('inventory','/api/inventory-reviews/not-an-id').expect(400);
  await request(app).post(path).set('Cookie',sessions.owner.cookie).set('Origin',origin).set('X-CSRF-Token',sessions.owner.csrf).send({...approve,stockDelta:'10'}).expect(422);
  await db.pool.query('UPDATE users SET active=false WHERE id=$1',[ids.inventory]);await get('inventory').expect(401);
 }finally{await db.close();}
});
