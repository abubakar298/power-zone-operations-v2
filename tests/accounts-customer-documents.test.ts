import {groupAccountsCustomerDocuments} from '../shared/accounts-customer-documents.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import request from 'supertest';
import {customerDocumentReferences,projectCustomerDocuments,customerDocumentSiteClosed} from '../server/accounts/customer-documents.js';
import {testDatabase} from './database.js';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import {digest} from '../server/auth/crypto.js';
test('typed customer documents preserve partial deliveries and deduplicate mirrors without including IRRs, photos or orphan files',()=>{
 const [a,b,vso,ack,irr,photo]=Array.from({length:6},()=>randomUUID());
 const refs=customerDocumentReferences([{site_id:'site',version:4,snapshot:{name:'Safe site',customer:'UBL',ipo:'CHP-163 · 142/250',completed:false,deliveries:[{signedDo:{id:a},partial:true},{signedDo:{id:b},partial:false}],qcJob:{date:'2026-11-01',acknowledgement:{id:ack},variableSignoff:{id:vso},irr:{id:irr},evidence:{id:photo}},documents:[{id:'site:completion-documents',evidence:[{id:ack},{id:irr},{id:vso}]}]}}]);
 const files=[a,b,vso,ack,irr,photo].map(id=>({id,site_id:'site',filename:'Original.jpg',created_at:'2026-11-01T10:00:00Z',media_type:'image/jpeg'}));
 const rows=projectCustomerDocuments(refs,files);assert.equal(rows.length,4);assert.equal(rows.filter(r=>r.kind==='Signed DO').length,2);assert.equal(rows.filter(r=>r.kind==='VSO').length,1);assert.equal(rows.filter(r=>r.kind==='Acknowledgment').length,1);
 assert.equal(projectCustomerDocuments(refs,files.map(f=>({...f,site_id:'wrong-site'}))).length,0);
 assert.equal(projectCustomerDocuments(customerDocumentReferences([{site_id:'superseded',version:1,snapshot:{superseded:true,qcJob:{acknowledgement:{id:ack}}}}]),files).length,0);
});
test('only the exact Management-closed job leaves Approved Documents; completed/open and shared-IPO sites remain',()=>{
 const closedIpo=randomUUID(),openIpo=randomUUID(),closed=new Set(['ipo:'+closedIpo,'ubl:40']);
 const legacy=new Map([['UBL:SOLAR:311','ubl:40']]);
 assert.equal(customerDocumentSiteClosed({site_id:'native',version:1,snapshot:{origin:{ipoId:closedIpo}}},closed,new Map(),legacy),true);
 assert.equal(customerDocumentSiteClosed({site_id:'other',version:1,snapshot:{completed:true,ipo:'CHP-163',origin:{ipoId:openIpo}}},closed,new Map(),legacy),false);
 assert.equal(customerDocumentSiteClosed({site_id:'received-UBL:SOLAR:311',version:1,snapshot:{}},closed,new Map(),legacy),true);
 assert.equal(customerDocumentSiteClosed({site_id:'received-UBL:UPS:311/250',version:1,snapshot:{ipo:'CHP-311'}},closed,new Map(),legacy),false);
 assert.equal(customerDocumentSiteClosed({site_id:'linked',version:1,snapshot:{}},closed,new Map([['linked',[closedIpo]]]),legacy),true);
 assert.equal(customerDocumentSiteClosed({site_id:'linked',version:1,snapshot:{origin:{ipoId:openIpo}}},closed,new Map([['linked',[closedIpo]]]),legacy),false,'A different current native origin prevents stale-link cross-closure.');
});
test('site grouping counts a site once and retains every partial DO and signature file',()=>{
 const rows=projectCustomerDocuments(customerDocumentReferences([{site_id:'one',version:1,snapshot:{name:'One',ipo:'CHP-163',deliveries:[{signedDo:{id:'11111111-1111-4111-8111-111111111111'}},{signedDo:{id:'22222222-2222-4222-8222-222222222222'}}]}},{site_id:'two',version:1,snapshot:{name:'Two',ipo:'CHP-163',qcJob:{acknowledgement:{id:'33333333-3333-4333-8333-333333333333'}}}}]),[{id:'11111111-1111-4111-8111-111111111111',site_id:'one',filename:'DO1',created_at:'2026-11-01T10:00:00Z',media_type:'application/pdf'},{id:'22222222-2222-4222-8222-222222222222',site_id:'one',filename:'DO2',created_at:'2026-11-01T11:00:00Z',media_type:'application/pdf'},{id:'33333333-3333-4333-8333-333333333333',site_id:'two',filename:'Ack',created_at:'2026-11-01T09:00:00Z',media_type:'application/pdf'}]);
 const sites=groupAccountsCustomerDocuments(rows);assert.equal(sites.length,2);assert.equal(sites[0].siteId,'one');assert.equal(sites[0].documents.length,2);assert.equal(sites[1].siteId,'two','Shared IPO text does not merge distinct sites.');
});
test('Accounts receives and downloads committed QC signed documents without Inventory/PT, gates, returns or IRR; other roles and orphan/cross-site files remain blocked',async()=>{
 const db=await testDatabase();try{
  const sessions:Record<string,string>={},users:Record<string,string>={};
  for(const role of ['Admin','Accounts','Inventory','Operations','Coordinator']){const id=users[role]=randomUUID(),token=randomBytes(32).toString('base64url');await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash)VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role,role,'isolated']);await db.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at)VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),id,randomUUID()]);sessions[role]='pz_session='+token;}
  const site='qc-customer-documents',other='other-site',ids=Array.from({length:6},()=>randomUUID());
  for(const id of [site,other])await db.pool.query('INSERT INTO operations_board_sites(id,created_by)VALUES($1,$2)',[id,users.Admin]);
  const content=Buffer.from('%PDF-1.7\nFictional original signed document bytes');
  for(const [i,id]of ids.entries())await db.pool.query('INSERT INTO operations_board_files(id,site_id,filename,media_type,sha256,content,created_by)VALUES($1,$2,$3,$4,$5,$6,$7)',[id,i===5?other:site,'Signed-'+i+'.pdf','application/pdf',String(i+1).repeat(64),content,users.Admin]);
  const closedIpo=randomUUID();
  const snapshot={id:site,origin:{ipoId:closedIpo},name:'Independent QC site',customer:'UBL',ipo:'IPO-QC-ONLY',stage:'delivered',installation:true,completed:false,deliveries:[{signedDo:{id:ids[0]},deliveryDate:'2026-10-30',partial:true},{signedDo:{id:ids[1]},deliveryDate:'2026-10-31',partial:false}],qcJob:{date:'2026-11-01',acknowledgement:{id:ids[2]},variableSignoff:{id:ids[3]},irr:{id:ids[4]}},documents:[]};
  await db.pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by)VALUES($1,1,$2,$3,$4,$5,$6)',[site,snapshot,'QC signed documents','Isolated audit',randomUUID(),users.Admin]);
  const app=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:'http://127.0.0.1:5173',DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'qc-customer-documents-local-test-setup-key'}));
  await request(app).get('/api/accounts-workspace/customer-documents').expect(401);
  for(const role of ['Inventory','Operations','Coordinator'])await request(app).get('/api/accounts-workspace/customer-documents').set('Cookie',sessions[role]).expect(403);
  const data=(await request(app).get('/api/accounts-workspace/customer-documents').set('Cookie',sessions.Accounts).expect(200)).body;
  assert.equal(data.rows.length,4);assert.deepEqual(new Set(data.rows.map((r:any)=>r.kind)),new Set(['Signed DO','VSO','Acknowledgment']));
  const count=(await request(app).get('/api/accounts-workspace/customer-documents?summary=1').set('Cookie',sessions.Accounts).expect(200)).body;assert.equal(count.count,1);assert.equal(count.documents,4);assert.equal(groupAccountsCustomerDocuments(data.rows)[0].documents.length,4);
  assert.equal((await request(app).get('/api/accounts-workspace/customer-documents').query({jobKey:'ipo:'+closedIpo}).set('Cookie',sessions.Accounts).expect(200)).body.rows.length,4);
  assert.equal((await request(app).get('/api/accounts-workspace/customer-documents').query({jobKey:'ipo:'+randomUUID()}).set('Cookie',sessions.Accounts).expect(200)).body.rows.length,0,'A different job must never receive files through matching display names or IPO text.');
  const doc=data.rows.find((r:any)=>r.kind==='VSO');const download=await request(app).get(doc.downloadUrl).set('Cookie',sessions.Accounts).expect(200);assert.equal(download.body.toString(),content.toString());assert.match(download.headers['cache-control'],/no-store/);
  await request(app).get('/api/accounts-workspace/customer-documents/'+'f'.repeat(64)+'/file').set('Cookie',sessions.Accounts).expect(404);
  await request(app).get(doc.downloadUrl).set('Cookie',sessions.Inventory).expect(403);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_reports')).rows[0].n,0);assert.equal((await db.pool.query('SELECT count(*)::int n FROM accounts_pt_entries')).rows[0].n,0);assert.equal((await db.pool.query('SELECT count(*)::int n FROM inventory_warehouse_operational_movements')).rows[0].n,0);
  const report=randomUUID(),reportVersion=randomUUID(),jobKey='ipo:'+closedIpo;
  await db.pool.query('INSERT INTO inventory_reports(id,job_key,created_by)VALUES($1,$2,$3)',[report,jobKey,users.Admin]);
  await db.pool.query("INSERT INTO inventory_report_versions(id,report_id,version,stage,snapshot,request_key,created_by)VALUES($1,$2,1,'Sent to Accounts','{}',$3,$4)",[reportVersion,report,randomUUID(),users.Admin]);
  await db.pool.query("INSERT INTO accounts_job_closures(id,job_key,report_version_id,version,stage,snapshot,request_key,created_by)VALUES($1,$2,$3,1,'Awaiting Management','{}',$4,$5)",[randomUUID(),jobKey,reportVersion,randomUUID(),users.Admin]);
  assert.equal((await request(app).get('/api/accounts-workspace/customer-documents?summary=1').set('Cookie',sessions.Accounts).expect(200)).body.count,1,'Awaiting approval is not Closed.');
  await db.pool.query("INSERT INTO accounts_job_closures(id,job_key,report_version_id,version,stage,snapshot,request_key,created_by)VALUES($1,$2,$3,2,'Closed','{}',$4,$5)",[randomUUID(),jobKey,reportVersion,randomUUID(),users.Admin]);
  assert.equal((await request(app).get('/api/accounts-workspace/customer-documents?summary=1').set('Cookie',sessions.Accounts).expect(200)).body.count,0,'The exact closed site leaves the active bucket and counter.');
  assert.equal((await request(app).get('/api/accounts-workspace/customer-documents').set('Cookie',sessions.Accounts).expect(200)).body.rows.length,0);
  const historical=await request(app).get(doc.downloadUrl).set('Cookie',sessions.Accounts).expect(200);assert.equal(historical.body.toString(),content.toString(),'Closing preserves original evidence download access.');

 }finally{await db.close();}
});
