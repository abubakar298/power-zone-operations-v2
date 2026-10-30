import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import request from 'supertest';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import {digest} from '../server/auth/crypto.js';
import {testDatabase} from './database.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';

test('Operations board persists immutable scoped documents, evidence and concurrent version decisions without stock or financial postings',async()=>{
 const db=await testDatabase();try{
  const roles:Record<string,string>={owner:'Admin',head:'Operations',central:'Operations',southQc:'Operations',unassigned:'Operations',accounts:'Accounts',inventory:'Inventory'};
  const users:Record<string,string>={},sessions:Record<string,{cookie:string;csrf:string}>={};
  for(const [key,role] of Object.entries(roles)){
   const id=users[key]=randomUUID(),token=randomBytes(32).toString('base64url'),csrf=randomUUID();
   await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',key,role,'isolated']);
   await db.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),id,csrf]);sessions[key]={cookie:'pz_session='+token,csrf};
  }
  for(const [key,kind,team] of [['head','head',null],['central','lead','central'],['southQc','qc','south']])await db.pool.query('INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,$2,$3,$4)',[users[key!],kind,team,users.owner]);
  const repo=new OperationsBoardRepository(db.pool),fileId=randomUUID(),orphanId=randomUUID();
  const source={sourceSha256:'b'.repeat(64),rows:[{id:'safe-central',ipo:'IPO-C',name:'Central sample',stage:'delivered' as const,installation:true,operationsTeam:'central' as const,assignments:{delivery:'Private operational vendor'},documents:[{id:'do-central',label:'Delivery DO',location:'At site' as const,date:'2026-10-01',createdDate:'2026-10-01',evidence:[{id:fileId,name:'signed.pdf'}],history:[]}]},{id:'safe-south',ipo:'IPO-S',name:'South sample',stage:'received' as const,installation:true,operationsTeam:'south' as const,documents:[]}]};
  await assert.rejects(repo.physicalDocuments(users.accounts),/not been imported/);
  await assert.rejects(repo.importSource(users.owner,{sourceSha256:'b'.repeat(64),rows:[{...source.rows[0],installation:null,scopePending:false}]}),/Unknown installation scope/);
  await assert.rejects(repo.importSource(users.head,source),/Management/);
  assert.deepEqual(await repo.importSource(users.owner,source),{imported:2,retained:0});
  assert.deepEqual(await repo.importSource(users.owner,source),{imported:0,retained:2});
  assert.equal((await repo.sites(users.central)).sites.length,1);assert.equal((await repo.sites(users.southQc)).sites[0].id,'safe-south');assert.equal((await repo.sites(users.head)).sites.length,2);
  await assert.rejects(repo.site(users.southQc,'safe-central'),/not found/);await assert.rejects(repo.sites(users.unassigned),/not assigned/);await assert.rejects(repo.site(users.accounts,'safe-central'),/tracking only/);
  const physical=await repo.physicalDocuments(users.accounts);assert.equal(physical.sites.length,2);assert.equal((physical.sites[0] as any).assignments,undefined);
  const content=Buffer.from('%PDF-1.7\nLocal fixture');
  for(const id of [fileId,orphanId])await db.pool.query('INSERT INTO operations_board_files(id,site_id,filename,media_type,sha256,content,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,'safe-central','signed.pdf','application/pdf',id===fileId?'a'.repeat(64):'c'.repeat(64),content,users.owner]);
  assert.ok((await repo.download(users.accounts,'safe-central',fileId)).content.equals(content));await assert.rejects(repo.download(users.accounts,'safe-central',orphanId),/not found/);await assert.rejects(repo.download(users.southQc,'safe-central',fileId),/not found/);
  const upload={filename:'new.pdf',mediaType:'application/pdf' as const,base64:Buffer.from('%PDF-1.7\nnew fixture').toString('base64')};
  const uploaded=await repo.upload(users.central,'safe-central',upload);assert.equal((await repo.upload(users.central,'safe-central',upload)).id,uploaded.id);await assert.rejects(repo.upload(users.accounts,'safe-central',upload),/tracking only/);await assert.rejects(repo.upload(users.central,'safe-central',{...upload,base64:Buffer.from('<svg onload="alert(1)">').toString('base64')}),/matches its file type/);
  const heic=Buffer.alloc(24);heic.writeUInt32BE(24);heic.write('ftyp',4);heic.write('heic',8);heic.write('mif1',16);heic.write('heic',20);
  for(const mediaType of ['image/heic','image/heif'] as const)assert.ok((await repo.upload(users.central,'safe-central',{filename:'phone.heic',mediaType,base64:heic.toString('base64')})).id);
  const webp=Buffer.alloc(16);webp.write('RIFF');webp.write('WEBP',8);assert.ok((await repo.upload(users.central,'safe-central',{filename:'phone.webp',mediaType:'image/webp',base64:webp.toString('base64')})).id);
  const largerPdf=Buffer.alloc(8388609);largerPdf.write('%PDF-1.7');assert.ok((await repo.upload(users.central,'safe-central',{filename:'large.pdf',mediaType:'application/pdf',base64:largerPdf.toString('base64')})).id,'existing preview support above8MB must remain available');
  const movement={version:1,requestKey:randomUUID(),documentId:'do-central',location:'TCS to Karachi office' as const,date:'2026-10-02',tracking:'TCS-TEST',carrier:'',edit:false,reason:''};
  const moved=await repo.moveDocument(users.central,'safe-central',movement);assert.equal(moved.version,2);assert.equal((await repo.moveDocument(users.central,'safe-central',movement)).version,2);
  await assert.rejects(repo.moveDocument(users.central,'safe-central',{...movement,tracking:'OTHER'}),/different update/);await assert.rejects(repo.moveDocument(users.central,'safe-central',{...movement,requestKey:randomUUID()}),/site was updated/);
  await assert.rejects(repo.moveDocument(users.central,'safe-central',{...movement,version:2,requestKey:randomUUID(),edit:true}),/reason/);
  const concurrent=await Promise.allSettled([1,2].map(n=>repo.moveDocument(users.central,'safe-central',{...movement,version:2,requestKey:randomUUID(),location:'Received at Karachi office',date:'2026-10-03',reason:String(n)})));
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(concurrent.filter(r=>r.status==='rejected').length,1);
  const submitted=await repo.moveDocument(users.central,'safe-central',{...movement,version:3,requestKey:randomUUID(),location:'Submitted to Accounts',date:'2026-10-04'});assert.equal(submitted.version,4);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM operations_board_events')).rows[0].n,3);
  await repo.moveDocument(users.central,'safe-central',{...movement,version:4,requestKey:randomUUID(),location:'Submitted to Accounts',date:'2026-10-04',edit:true,reason:'Correct consignment reference',tracking:'TCS-CORRECTED'});
  assert.deepEqual((await db.pool.query("SELECT audiences FROM operations_board_events WHERE kind='Document movement corrected'")).rows[0].audiences,['accounts','operations-head','management']);
  await repo.importSource(users.owner,source);assert.equal((await repo.site(users.owner,'safe-central')).version,5,'reimport must retain ongoing decisions');
  await assert.rejects(db.pool.query("UPDATE operations_board_versions SET reason='erase' WHERE site_id='safe-central'"));await assert.rejects(db.pool.query('DELETE FROM operations_board_files WHERE id=$1',[fileId]));
  const origin='http://localhost:3000',app=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:origin,DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'operations-board-isolated-long-token'}));
  const get=(key:string,path:string)=>request(app).get(path).set('Cookie',sessions[key].cookie);
  await request(app).get('/api/operations-board/sites').expect(401);
  assert.equal((await get('central','/api/operations-board/sites')).body.sites.length,1);await get('southQc','/api/operations-board/sites/safe-central').expect(404);await get('unassigned','/api/operations-board/sites').expect(403);await get('inventory','/api/operations-board/sites').expect(403);await get('accounts','/api/operations-board/sites').expect(403);
  for(const path of ['/api/site-workflow','/api/site-workflow/report','/api/project-workflow/advance-inbox'])await get('southQc',path).expect(403);
  const docs=await get('accounts','/api/accounts-workspace/physical-documents').expect(200);assert.match(docs.headers['cache-control'],/no-store/);assert.equal(docs.body.sites.find((s:any)=>s.id==='safe-central').documents[0].location,'Submitted to Accounts');
  const download=await get('accounts',`/api/operations-board/sites/safe-central/files/${fileId}`).expect(200);assert.match(download.headers['content-disposition'],/attachment/);assert.match(download.headers['content-security-policy'],/sandbox/);await get('accounts',`/api/operations-board/sites/safe-central/files/${orphanId}`).expect(404);
  await request(app).post('/api/operations-board/sites/safe-central/document-movements').set('Cookie',sessions.central.cookie).set('Origin',origin).send(movement).expect(403);
  await db.pool.query('UPDATE users SET active=false WHERE id=$1',[users.central]);await get('central','/api/operations-board/sites').expect(401);
  for(const table of ['internal_purchase_orders','accounts_job_closures','stock_on_hand_entries'])assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n,0);
 }finally{await db.close();}
});
