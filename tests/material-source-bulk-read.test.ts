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
