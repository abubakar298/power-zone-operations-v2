import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {OperationsLiveIpoSync,syncCreatedOperationsHandoff} from '../server/operations-board/live-ipo-sync.js';

test('explicit live IPO sync is duplicate-safe, retains reviewed decisions and never posts source history, evidence, stock or money',async()=>{
 const db=await testDatabase();try{
  const manager=randomUUID(),coordinator=randomUUID();
  for(const [id,role]of [[manager,'Admin'],[coordinator,'Coordinator']])await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'SIMULATION','test-only',$3)",[id,id+'@example.test',role]);
  const sync=new OperationsLiveIpoSync(db.pool);let sequence=0;
  async function issuance(options:{ipoNumber?:string;order?:string;stage?:string;poNumber?:string;approvalReference?:string;missingWorkflow?:boolean;missingHandoff?:boolean;historical?:boolean;delivered?:string;family?:string;siteType?:string;scope?:string;humanSiteType?:boolean}={}){
   const ipoId=randomUUID(),poId=randomUUID(),opId=randomUUID(),draftId=randomUUID(),boqId=randomUUID(),revisionId=randomUUID(),workflowId=randomUUID(),documentId=randomUUID(),index=++sequence;
   const siteId=(await db.pool.query('SELECT COALESCE(max(id),0)+1 AS id FROM sites')).rows[0].id;
   await db.pool.query("INSERT INTO sites(id,customer_id,name,code,location,status) VALUES($1,1,$2,$3,'Lahore','Active')",[siteId,'SIMULATION Site '+index,'SYN'+index]);
   await db.pool.query("INSERT INTO survey_drafts(id,owner_id,inputs) VALUES($1,$2,'{}')",[draftId,coordinator]);
   await db.pool.query('INSERT INTO boqs(id,draft_id,site_id,customer_id,sequence,created_by) VALUES($1,$2,$3,1,1,$4)',[boqId,draftId,siteId,coordinator]);
   await db.pool.query('INSERT INTO boq_revisions(id,boq_id,revision,number,snapshot,created_by) VALUES($1,$2,0,$3,$4,$5)',[revisionId,boqId,'SIMULATION-PBQ-'+index,{survey:{customerId:1,siteCode:'SYN'+index,...(options.family?{family:options.family}:{})},lines:[],total:'100.00'},coordinator]);
   await db.pool.query("INSERT INTO customer_po_documents(id,owner_id,filename,mime,sha256,content) VALUES($1,$2,'SIMULATION-source.pdf','application/pdf',$3,$4)",[documentId,coordinator,'a'.repeat(64),Buffer.from('%PDF-1.4\n% SIMULATION SOURCE ONLY\n%%EOF')]);
   await db.pool.query("INSERT INTO customer_purchase_orders(id,customer_id,po_number,document_id,input,created_by) VALUES($1,1,$2,$3,'{}',$4)",[poId,options.approvalReference??'SIMULATION-PO-'+index,documentId,coordinator]);
   const number=options.ipoNumber??'SIMULATION-IPO-'+index,order=options.order??'';
   const snapshot={siteName:'SIMULATION Site '+index,siteCode:'SYN'+index,boqRevisionId:revisionId,input:{orderNumber:order,poNumber:options.poNumber??'SIMULATION-PO-'+index},...(options.historical?{historicalImport:{kind:'verified-register-import'}}:{})};
   await db.pool.query('INSERT INTO internal_purchase_orders(id,customer_po_id,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[ipoId,poId,number,snapshot,'b'.repeat(64),randomUUID(),coordinator]);
   if(!options.missingHandoff)await db.pool.query('INSERT INTO operations_boq_issuances(id,ipo_id,boq_revision_id,number,snapshot,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[opId,ipoId,revisionId,'SIMULATION-FBOQ-'+index,{orderNumber:order,items:[],...(options.historical?{bulkHistoricalImport:true}:{})},randomUUID(),coordinator]);
   if(!options.missingHandoff&&!options.missingWorkflow)await db.pool.query('INSERT INTO site_workflow(id,issuance_id,ipo_id,site_id,customer_id,stage,stage_entered_at,delivered_on) VALUES($1,$2,$3,$4,1,$5,$6,$7)',[workflowId,opId,ipoId,siteId,options.stage??'ipo_received','2026-10-20T12:00:00Z',options.delivered??null]);
   if(!options.missingHandoff&&!options.missingWorkflow&&(options.scope||options.siteType))await db.pool.query('UPDATE site_workflow SET scope=$2,site_type=$3 WHERE id=$1',[workflowId,options.scope??null,options.siteType??null]);
   if(options.humanSiteType)await db.pool.query("INSERT INTO site_workflow_events(workflow_id,kind,changes,created_by) VALUES($1,'field_update',$2,$3)",[workflowId,{siteType:{from:null,to:options.siteType}},manager]);
   return {ipoId,opId,workflowId,revisionId,documentId,number,order,siteName:'SIMULATION Site '+index};
  }
  async function sourceProof(){const result:Record<string,unknown>={};for(const table of ['internal_purchase_orders','customer_purchase_orders','operations_boq_issuances','site_workflow','customer_po_documents','boq_revisions','inventory_warehouse_operational_movements','accounts_pt_entries'])result[table]=(await db.pool.query(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) hash,count(*)::int n FROM ${table} t`)).rows[0];return result;}
  const fresh=await issuance(),before=await sourceProof();
  const replies=await Promise.all([sync.sync(manager,{ipoIds:[fresh.ipoId]}),sync.sync(manager,{ipoIds:[fresh.ipoId]})]);
  assert.equal(replies.reduce((n,r)=>n+r.created.length,0),1);assert.equal(replies.reduce((n,r)=>n+r.retained.length,0),1);
  const boardId='live-ipo:'+fresh.ipoId,stored=(await db.pool.query('SELECT snapshot FROM operations_board_versions WHERE site_id=$1',[boardId])).rows[0].snapshot;
  assert.equal(stored.customer,(await db.pool.query('SELECT name FROM customers WHERE id=1')).rows[0].name);assert.equal(stored.customerId,1);assert.equal(stored.scopePending,true);assert.equal(stored.installation,null);assert.equal(stored.projectType,null);assert.deepEqual(stored.documents,[]);assert.deepEqual(stored.qc,{});assert.equal(stored.legacySourceReferences.customerPoDocumentId,fresh.documentId);assert.match(stored.origin.sourceSha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(await sourceProof(),before);assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_board_events')).rows[0].n,0);assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_board_files')).rows[0].n,0);
  const snapshot={...stored,operationsTeam:'south',notes:'Retain this saved Operations decision'};
  await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,2,$2,'SIMULATION decision','retention fixture',$3,$4)",[boardId,snapshot,randomUUID(),manager]);
  assert.equal((await sync.sync(manager,{ipoIds:[fresh.ipoId]})).retained[0].boardSiteId,boardId);
  assert.deepEqual((await db.pool.query('SELECT snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[boardId])).rows[0].snapshot,snapshot);
  const missing=await issuance({missingWorkflow:true}),noHandoff=await issuance({missingHandoff:true}),bulk=await issuance({historical:true});
  for(const record of [missing,noHandoff,bulk])assert.equal((await sync.sync(manager,{ipoIds:[record.ipoId]})).held.length,1);
  const reviewed=await issuance({family:'bess-only'});const reviewedId='reviewed-source-'+randomUUID();
  await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[reviewedId,manager]);
  await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Source imported','SIMULATION source',$3,$4)",[reviewedId,{id:reviewedId,ipo:reviewed.number,name:'Reviewed position',stage:'completed',installation:true,completed:true,documents:[]},randomUUID(),manager]);
  await db.pool.query('INSERT INTO inventory_material_source_links(id,board_site_id,board_version,ipo_id,boq_revision_id,board_sha256,ipo_sha256,boq_sha256,reason,request_key,request_sha256,created_by) VALUES($1,$2,1,$3,$4,$5,$5,$5,$6,$7,$5,$8)',[randomUUID(),reviewedId,reviewed.ipoId,reviewed.revisionId,'c'.repeat(64),'SIMULATION reviewed exact identity',randomUUID(),manager]);
  assert.equal((await sync.sync(manager,{ipoIds:[reviewed.ipoId]})).retained[0].boardSiteId,reviewedId);
  const candidate=await issuance({ipoNumber:'SIMULATION-SHARED-163',order:'211/250'});
  await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',['unverified-candidate',manager]);
  await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES('unverified-candidate',1,$1,'Source imported','SIMULATION source',$2,$3)",[{id:'unverified-candidate',ipo:candidate.number+' · '+candidate.order,name:'Reviewed branch',stage:'received',installation:null,scopePending:true},randomUUID(),manager]);
  assert.equal((await sync.sync(manager,{ipoIds:[candidate.ipoId]})).held.length,1);
  const wrongOrigin=await issuance(),wrongId='live-ipo:'+wrongOrigin.ipoId;
  await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[wrongId,manager]);
  await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Source imported','SIMULATION mismatch',$3,$4)",[wrongId,{id:wrongId,ipo:wrongOrigin.number,name:'Unverified origin',stage:'received',installation:null,scopePending:true,origin:{kind:'live-ipo-handoff',ipoId:wrongOrigin.ipoId,operationsIssuanceId:randomUUID(),legacyWorkflowId:wrongOrigin.workflowId}},randomUUID(),manager]);
  assert.equal((await sync.sync(manager,{ipoIds:[wrongOrigin.ipoId]})).held.length,1,'IPO-only origin never overrides a mismatched immutable issuance');
  const archived=await issuance();
  await db.pool.query("INSERT INTO archived_sample_ipos(ipo_id,reason,source_record) VALUES($1,'SIMULATION exact archive',$2)",[archived.ipoId,{simulation:true}]);
  assert.equal((await sync.sync(manager,{ipoIds:[archived.ipoId]})).held.length,1);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_board_sites WHERE id=$1',['live-ipo:'+archived.ipoId])).rows[0].n,0,'Archived samples are never imported');
  const archivedConnection=await db.pool.connect();try{
   await archivedConnection.query('BEGIN');
   assert.equal((await syncCreatedOperationsHandoff(archivedConnection,coordinator,{ipoId:archived.ipoId,operationsIssuanceId:archived.opId})).held.length,1,'Trusted callbacks respect exact sample archives');
   await archivedConnection.query('ROLLBACK');
  }finally{archivedConnection.release();}
  await db.pool.query('UPDATE archived_sample_ipos SET restored_at=now() WHERE ipo_id=$1',[archived.ipoId]);
  assert.equal((await sync.sync(manager,{ipoIds:[archived.ipoId]})).created.length,1,'Explicitly restored sources remain eligible');
  const emailApproval=await issuance({poNumber:'',approvalReference:'EMAIL-SIMULATION-APPROVAL'});
  assert.equal((await sync.sync(manager,{ipoIds:[emailApproval.ipoId]})).created.length,1);
  const approvalBoard=(await db.pool.query('SELECT snapshot FROM operations_board_versions WHERE site_id=$1',['live-ipo:'+emailApproval.ipoId])).rows[0].snapshot;
  assert.equal(approvalBoard.customerPo,'','An email approval reference never becomes a customer PO');
  assert.ok(approvalBoard.reviewFlags.some((flag:string)=>flag.includes('Customer PO is missing')));
  const trusted=await issuance();
  const connection=await db.pool.connect();try{
   await connection.query('BEGIN');
   const added=await syncCreatedOperationsHandoff(connection,coordinator,{ipoId:trusted.ipoId,operationsIssuanceId:trusted.opId});
   assert.equal(added.created.length,1,'Actual saved issuer can mirror only its handoff');
   await connection.query('ROLLBACK');
   assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_board_sites WHERE id=$1',['live-ipo:'+trusted.ipoId])).rows[0].n,0,'Mirrored positioning rolls back with its caller transaction');
   const other=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'SIMULATION','test-only','Coordinator')",[other,other+'@example.test']);
   await connection.query('BEGIN');
   await assert.rejects(syncCreatedOperationsHandoff(connection,other,{ipoId:trusted.ipoId,operationsIssuanceId:trusted.opId}),/authenticated handoff issuer/);
   await connection.query('ROLLBACK');
   await connection.query('BEGIN');
   assert.equal((await syncCreatedOperationsHandoff(connection,coordinator,{ipoId:trusted.ipoId,operationsIssuanceId:randomUUID()})).held.length,1);
   await connection.query('ROLLBACK');
  }finally{connection.release();}
  for(const [family,installation,projectType]of [['solar-hybrid',true,'solar-bess'],['bess-only',true,'ups'],['direct-product',false,'delivery-only']]as const){
   const record=await issuance({family,siteType:'BESS'});await sync.sync(manager,{ipoIds:[record.ipoId]});const row=(await db.pool.query('SELECT snapshot FROM operations_board_versions WHERE site_id=$1',['live-ipo:'+record.ipoId])).rows[0].snapshot;
   assert.equal(row.installation,installation);assert.equal(row.projectType,projectType);assert.equal(row.scopePending,false);assert.equal(row.legacyPosition.scope,null);assert.equal(row.legacyPosition.siteType,'BESS');assert.equal(row.approvedScopeBasis.boqRevisionId,record.revisionId);assert.equal((await db.pool.query('SELECT scope FROM site_workflow WHERE id=$1',[record.workflowId])).rows[0].scope,null);
  }
  const human=await issuance({family:'bess-only',siteType:'BESS',humanSiteType:true});await sync.sync(manager,{ipoIds:[human.ipoId]});assert.equal((await db.pool.query('SELECT snapshot FROM operations_board_versions WHERE site_id=$1',['live-ipo:'+human.ipoId])).rows[0].snapshot.projectType,'bess');
  const explicit=await issuance({family:'bess-only',siteType:'BESS',scope:'delivery_only'});await sync.sync(manager,{ipoIds:[explicit.ipoId]});assert.equal((await db.pool.query('SELECT snapshot FROM operations_board_versions WHERE site_id=$1',['live-ipo:'+explicit.ipoId])).rows[0].snapshot.installation,false);
  const pending=await issuance({family:'bess-only',siteType:'BESS'}),pendingId='live-ipo:'+pending.ipoId;
  const pendingSnapshot={...stored,id:pendingId,ipo:pending.number,name:pending.siteName,scopePending:true,installation:null,projectType:'bess',origin:{kind:'live-ipo-handoff',ipoId:pending.ipoId,operationsIssuanceId:pending.opId,legacyWorkflowId:pending.workflowId,sourceSha256:'f'.repeat(64)}};
  await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[pendingId,manager]);await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Source imported','SIMULATION prior source',$3,$4)",[pendingId,pendingSnapshot,randomUUID(),manager]);
  await sync.sync(manager,{ipoIds:[pending.ipoId]});const upgraded=(await db.pool.query('SELECT version,snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[pendingId])).rows[0];assert.equal(upgraded.version,2);assert.equal(upgraded.snapshot.installation,true);assert.equal(upgraded.snapshot.projectType,'ups');
  await sync.sync(manager,{ipoIds:[pending.ipoId]});assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_board_versions WHERE site_id=$1',[pendingId])).rows[0].n,2);
  const deliveredProduct=await issuance({family:'direct-product',stage:'delivery',delivered:'2026-10-21'}),productId='live-ipo:'+deliveredProduct.ipoId;
  const pendingProduct={...pendingSnapshot,id:productId,ipo:deliveredProduct.number,name:deliveredProduct.siteName,stage:'delivered',completed:false,origin:{kind:'live-ipo-handoff',ipoId:deliveredProduct.ipoId,operationsIssuanceId:deliveredProduct.opId,legacyWorkflowId:deliveredProduct.workflowId,sourceSha256:'f'.repeat(64)}};
  await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[productId,manager]);await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Source imported','SIMULATION prior product scope',$3,$4)",[productId,pendingProduct,randomUUID(),manager]);await sync.sync(manager,{ipoIds:[deliveredProduct.ipoId]});const scopedProduct=(await db.pool.query('SELECT snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[productId])).rows[0].snapshot;assert.equal(scopedProduct.completed,true);assert.equal(scopedProduct.stage,'completed');assert.equal(scopedProduct.evidencePending,true,'Saved delivery-only completion does not invent signed evidence.');
  const chosen={...upgraded.snapshot,notes:'SIMULATION saved Operations decision',scopePending:true};await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,3,$2,'SIMULATION decision','Preserve saved decision',$3,$4)",[pendingId,chosen,randomUUID(),manager]);await sync.sync(manager,{ipoIds:[pending.ipoId]});assert.deepEqual((await db.pool.query('SELECT snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[pendingId])).rows[0].snapshot,chosen);
  for(const role of ['Coordinator','Design','Operations','Inventory','Accounts']){const id=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'SIMULATION','test-only',$3)",[id,id+'@example.test',role]);await assert.rejects(sync.sync(id,{ipoIds:[fresh.ipoId]}),/Management approval/);}
  await db.pool.query('UPDATE users SET active=false WHERE id=$1',[manager]);await assert.rejects(sync.sync(manager,{ipoIds:[fresh.ipoId]}),/access has ended/);
 }finally{await db.close();}
});
