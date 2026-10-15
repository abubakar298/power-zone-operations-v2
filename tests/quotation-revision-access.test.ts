import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {CommercialRepository} from '../server/commercial/repository.js';
import {requireOwnedResource} from '../server/http/permissions.js';
test('Management returns a quotation to its Coordinator; owning Coordinator can resume or fork self revision without modifying source',async()=>{
 const db=await testDatabase();try{
 const c=db.pool,owner=randomUUID(),other=randomUUID(),manager=randomUUID();
 for(const [id,role] of [[owner,'Coordinator'],[other,'Coordinator'],[manager,'Management']])await c.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated',$4)",[id,`${id}@example.test`,role,role]);
 const site=(await c.query('SELECT id,customer_id FROM sites LIMIT 1')).rows[0];
 const repo=new CommercialRepository(c);
 async function fixture(){
 const draft=randomUUID(),boq=randomUUID(),revision=randomUUID(),pricing=randomUUID(),quote=randomUUID();
 await c.query("INSERT INTO survey_drafts(id,owner_id,inputs) VALUES($1,$2,'{}')",[draft,owner]);
 await c.query('INSERT INTO boqs(id,draft_id,site_id,customer_id,sequence,created_by) VALUES($1,$2,$3,$4,$5,$6)',[boq,draft,site.id,site.customer_id,Math.floor(Math.random()*1000000),owner]);
 await c.query("INSERT INTO boq_revisions(id,boq_id,revision,number,snapshot,created_by) VALUES($1,$2,0,$3,$4,$5)",[revision,boq,revision,{survey:{panelQty:32},frozenAmount:'123.45'},owner]);
 await c.query("INSERT INTO commercial_pricing_versions(id,boq_revision_id,version,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,1,$3,'{}','fixture',$4,$5)",[pricing,revision,pricing,randomUUID(),owner]);
 await c.query("INSERT INTO quotation_versions(id,pricing_id,boq_revision_id,version,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,$3,1,$4,$5,'fixture',$6,$7)",[quote,pricing,revision,quote,{siteName:'Fixture',frozenAmount:'123.45'},randomUUID(),owner]);
 await c.query("INSERT INTO coordination_events(id,quotation_id,kind,notes,created_by) VALUES($1,$2,'Submitted','test',$3)",[randomUUID(),quote,owner]);
 return {quote,revision};
 }
 const first=await fixture();
 const source=(await c.query('SELECT * FROM quotation_versions WHERE id=$1',[first.quote])).rows[0];
 const req=await repo.revisionStart(manager,first.quote,'Internal management',false,'Descriptions only','Director',randomUUID(),'return');
 assert.ok((await repo.revisionRequests(owner)).some((r:any)=>r.id===req.id));
 assert.ok(!(await repo.revisionRequests(other)).some((r:any)=>r.id===req.id));
 await requireOwnedResource(c,owner,'revisionRequest',req.id);
 await assert.rejects(requireOwnedResource(c,other,'revisionRequest',req.id));
 const resumed=await repo.revisionStart(owner,first.quote,'Internal management',false,'Resume descriptions','Atif',randomUUID());
 assert.equal(resumed.id,req.id);
 assert.equal((await c.query('SELECT * FROM quotation_versions WHERE id=$1',[first.quote])).rows[0].snapshot.frozenAmount,source.snapshot.frozenAmount);
 const second=await fixture();
 await assert.rejects(repo.revisionStart(owner,second.quote,'Internal management',false,'Return','Atif',randomUUID(),'return'),/Management approval/);
 await assert.rejects(repo.revisionStart(other,second.quote,'Internal management',false,'Other','Other',randomUUID()),/unavailable/);
 const fork=await repo.revisionStart(owner,second.quote,'Internal management',false,'Descriptions','Atif',randomUUID());
 assert.ok(fork.id);
 assert.equal((await c.query('SELECT kind FROM coordination_events WHERE quotation_id=$1 ORDER BY created_at DESC LIMIT 1',[second.quote])).rows[0].kind,'Submitted');
 const third=await fixture();
 const technical=await repo.revisionStart(manager,third.quote,'Internal management',true,'Quantity correction','Director',randomUUID(),'return');
 assert.equal((await c.query('SELECT owner_id FROM survey_drafts WHERE id=$1',[technical.draft_id])).rows[0].owner_id,owner);
 assert.deepEqual((await c.query('SELECT snapshot FROM boq_revisions WHERE id=$1',[third.revision])).rows[0].snapshot,{survey:{panelQty:32},frozenAmount:'123.45'});
 }finally{await db.close();}
});
