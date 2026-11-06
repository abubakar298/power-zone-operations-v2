import type {PoolClient} from 'pg';
import {allocateReference} from '../documents/references.js';
export async function finalizeCustomerBoq(c:PoolClient,quotationId:string,actor:string){
 await c.query('SELECT pg_advisory_xact_lock(742019040)');
 const row=(await c.query(`SELECT r.id,b.customer_id,r.snapshot->'survey'->>'siteCode' AS site_code FROM quotation_versions q JOIN boq_revisions r ON r.id=q.boq_revision_id JOIN boqs b ON b.id=r.boq_id JOIN boq_preliminary_references p ON p.revision_id=r.id WHERE q.id=$1`,[quotationId])).rows[0];
 if(!row||(await c.query('SELECT 1 FROM boq_customer_final_references WHERE revision_id=$1',[row.id])).rowCount)return;
 const number=await allocateReference(c,'BOQ',row.id,row.customer_id,row.site_code);
 await c.query('INSERT INTO boq_customer_final_references(revision_id,quotation_id,number,created_by) VALUES($1,$2,$3,$4)',[row.id,quotationId,number,actor]);
}
