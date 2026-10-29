import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {approvedMaterialIdentity,approvedMaterialIdentities} from '../server/inventory/source-links.js';
import {HttpError} from '../server/http/errors.js';
test('bulk IPO reads preserve single-record holds/corrections and use two queries regardless of linked-site count',async()=>{
 const rows=Array.from({length:100},(_,i)=>({id:randomUUID(),number:'IPO-'+i,snapshot:{siteCode:'OLD',siteName:'Site '+i,input:{poNumber:' PO  1 '}},saved_po_reference:'po 1',archived:false}));
 rows[1].archived=true;rows[2].snapshot.input.poNumber='wrong';
 const hash=(snapshot:unknown)=>createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
 const corrections=[3,4,5,6].map(i=>({id:randomUUID(),role:i===4?'Inventory':'Management',snapshot:{ipoId:rows[i].id,originalFingerprint:i===5?'stale':hash(rows[i].snapshot),previousSiteCode:'OLD',siteCode:'NEW',...(i===6?{previousSiteName:'Other site',siteName:'New site'}:{})}}));
 let queries=0;const db={query:async(sql:string,args:any[])=>{queries++;if(sql.includes('WHERE i.id=ANY'))return {rows};if(sql.includes('DISTINCT ON'))return {rows:corrections};const row=rows.find(r=>r.id===args[0]);if(sql.includes('FROM internal_purchase_orders'))return {rows:row?[{id:row.id,number:row.number,snapshot:row.snapshot,saved_po_reference:row.saved_po_reference}]:[]};if(sql.includes('FROM test_workflow_archives'))return {rowCount:row?.archived?1:0,rows:[]};if(sql.includes('FROM project_workflow_documents'))return {rows:corrections.filter(r=>r.snapshot.ipoId===args[0])};throw Error('Unexpected query');}};
 const bulk=await approvedMaterialIdentities(db as any,[...rows.map(r=>r.id),rows[0].id]);assert.equal(queries,2);
 for(const row of rows){let single;try{single=await approvedMaterialIdentity(db as any,row.id);}catch(error){single=error;}
  const actual=bulk.get(row.id);if(single instanceof HttpError){assert(actual instanceof HttpError);assert.equal(actual.status,single.status);assert.equal(actual.message,single.message);}else assert.deepEqual(actual,single);
 }
 assert.equal(bulk.get(rows[3].id).snapshot.siteCode,'NEW');assert.equal(rows[3].snapshot.siteCode,'OLD','Original snapshot is not rewritten');
 const before=queries;assert.equal((await approvedMaterialIdentities(db as any,[])).size,0);assert.equal(queries,before);
});

test('native bulk archive projection preserves array, object and scalar membership with a large historical archive',async()=>{
 const {testDatabase}=await import('./database.js');const db=await testDatabase();try{
  const actor=randomUUID(),customer=(await db.pool.query('SELECT id FROM customers ORDER BY id LIMIT 1')).rows[0].id;
  await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash)VALUES($1,$2,$3,$4,$5)',[actor,'bulk-native@example.test','Native fixture','Admin','isolated']);
  const ids=Array.from({length:4},()=>randomUUID());
  for(const [i,id]of ids.entries()){const po=randomUUID(),number='ISOLATED-BULK-'+i;await db.pool.query('INSERT INTO customer_purchase_orders(id,customer_id,po_number,input,created_by)VALUES($1,$2,$3,$4,$5)',[po,customer,number,{},actor]);await db.pool.query('INSERT INTO internal_purchase_orders(id,customer_po_id,number,snapshot,fingerprint,request_key,created_by)VALUES($1,$2,$3,$4,$5,$6,$7)',[id,po,number,{siteCode:'S'+i,input:{poNumber:number}},'test',randomUUID(),actor]);}
  const values=[[...Array.from({length:10000},()=>randomUUID()),ids[0]],{[ids[1]]:true},ids[2]];
  for(const [i,value]of values.entries())await db.pool.query('INSERT INTO test_workflow_archives(key,cutoff,counts,records)VALUES($1,now(),$2,$3)',['ISOLATED-BULK-'+i,{}, {localPreviewDocumentIds:value}]);
  const rows=await approvedMaterialIdentities(db.pool,ids);
  for(const id of ids){let expected;try{expected=await approvedMaterialIdentity(db.pool,id);}catch(e){expected=e;}const actual=rows.get(id);if(expected instanceof HttpError){assert(actual instanceof HttpError);assert.equal(actual.message,expected.message);}else assert.deepEqual(actual,expected);}
  assert(!(rows.get(ids[3]) instanceof HttpError));
 }finally{await db.close();}
});
