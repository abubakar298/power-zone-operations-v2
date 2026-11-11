import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {qcMaterialHandoff,qcMaterialHandoffs} from '../server/accounts/qc-material-handoff.js';
import {testDatabase} from './database.js';

// Opening one job must give exactly the same result (including the signature
// checked at closure) as picking that job out of the full Accounts list.
test('one-job QC material handoff equals the matching entry of the full list',async()=>{
 const db=await testDatabase();try{
  const owner=randomUUID(),coord=randomUUID();
  for(const [id,role] of [[owner,'Admin'],[coord,'Coordinator']])await db.pool.query('INSERT INTO users(id,email,display_name,password_hash,role)VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role,'not-a-login',role]);
  const {createDashboardSamples}=await import('../server/coordinator/samples.js');
  const ipos=[...new Set((await createDashboardSamples(db.pool,coord,owner)).map((r:any)=>r.ipoId).filter(Boolean))] as string[];
  assert.ok(ipos.length>=2,'Fixture needs two IPOs');
  const board=async(name:string,ipoId:string,extra:Record<string,unknown>={},local=false)=>{
   const id='single-job-'+randomUUID(),file=randomUUID();
   await db.pool.query('INSERT INTO operations_board_sites(id,created_by)VALUES($1,$2)',[id,owner]);
   await db.pool.query("INSERT INTO operations_board_files(id,site_id,filename,media_type,sha256,content,created_by)VALUES($1,$2,'signed-do.pdf','application/pdf',$3,$4,$5)",[file,id,'a'.repeat(64),Buffer.from('%PDF-1.7 signed'),owner]);
   await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by)VALUES($1,1,$2,'Fixture','Fixture',$3,$4)",[id,{id,name,ipo:name,customer:'UBL',origin:{ipoId},stage:'delivered',installation:true,completed:true,projectType:'ups',operationsTeam:'central',deliveries:[{signedDo:{id:file},deliveryDate:'2026-11-01',partial:false}],documents:[],...extra},randomUUID(),owner]);
   if(local)await db.pool.query("INSERT INTO operations_site_local_purchase_versions(site_id,version,snapshot,request_key,request_fingerprint,created_by)VALUES($1,1,$2,$3,$4,$5)",[id,{items:[],noWarehouseMaterials:true,destination:'Accounts',stockPosting:false},randomUUID(),'b'.repeat(64),owner]);
   return id;
  };
  const ready=await board('Ready site',ipos[0],{},true);
  const twinA=await board('Twin site A',ipos[1],{},true),twinB=await board('Twin site B',ipos[1]);
  const archived=await board('Archived site',ipos[0],{archived:true},true);
  const all=await qcMaterialHandoffs(db.pool);
  const expected=(key:string)=>{const m=all.filter(r=>r.jobKey===key||r.aliases.includes(key));return m.length===1?m[0]:null;};
  const keys=['ipo:'+ipos[0],'ipo:'+ipos[1],...[ready,twinA,twinB,archived].map(id=>'site:'+id),'ipo:'+randomUUID(),'site:missing'];
  // Sanity: the fixture covers a ready job, a blocked duplicate and an excluded archived site.
  assert.equal(expected('ipo:'+ipos[0])?.ready,true);
  assert.equal(expected('ipo:'+ipos[1]),null);
  assert.match(expected('site:'+twinA)!.holds.join(';'),/Multiple Operations site links need review/);
  assert.equal(expected('site:'+archived),null);
  for(const key of keys)assert.deepEqual(await qcMaterialHandoff(db.pool,key),expected(key),key);
  // Transactions (a checked-out client) take the same path.
  const client=await db.pool.connect();
  try{for(const key of keys)assert.deepEqual(await qcMaterialHandoff(client,key),expected(key),'client '+key);}
  finally{client.release();}
 }finally{await db.close();}
});
