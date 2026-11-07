import type {Pool,PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';

export async function requireUnarchivedQuotation(c:Pool|PoolClient,id:string){
 if((await c.query('SELECT 1 FROM quotation_archives_current WHERE archived AND (quotation_id=$1 OR cni_proposal_id=$1 OR cni_proposal_id=(SELECT proposal_id FROM cni_proposal_versions WHERE id=$1))',[id])).rowCount)throw new HttpError(409,'This quotation is archived. Management must restore it before continuing.');
}
async function manager(c:Pool|PoolClient,actor:string){
 if(!(await c.query("SELECT 1 FROM users WHERE id=$1 AND active AND role IN('Admin','Management')",[actor])).rowCount)throw new HttpError(403,'Only Management can archive or restore quotations.');
}
export async function quotationArchiveRegister(pool:Pool,actor:string){
 await manager(pool,actor);
 const samples=new Set((await pool.query("SELECT jsonb_array_elements_text(records->'localPreviewDocumentIds') AS id FROM test_workflow_archives WHERE key LIKE 'LOCAL-REVIEW-SAMPLES-%'")).rows.map(r=>r.id));
 return (await pool.query(`SELECT q.id,'quotation' AS kind,q.number,q.version,q.created_at,q.snapshot->'customer'->>'name' AS customer,q.snapshot->>'siteName' AS site,COALESCE(a.archived,false) AS archived FROM quotation_versions q LEFT JOIN quotation_archives_current a ON a.quotation_id=q.id
 UNION ALL SELECT p.id,'cni',v.number,v.version,v.created_at,v.snapshot->'customer'->>'name',v.snapshot->>'siteName',COALESCE(a.archived,false) FROM cni_proposals p JOIN LATERAL(SELECT * FROM cni_proposal_versions WHERE proposal_id=p.id ORDER BY version DESC LIMIT 1)v ON true LEFT JOIN quotation_archives_current a ON a.cni_proposal_id=p.id ORDER BY created_at DESC`)).rows.filter(r=>!samples.has(r.id));
}
export async function setQuotationArchived(pool:Pool,actor:string,id:string,kind:'quotation'|'cni',archived:boolean){
 return transaction(pool,async c=>{
  await manager(c,actor);
  await c.query('SELECT pg_advisory_xact_lock(742019006)');
  const document=(await c.query(kind==='quotation'?'SELECT id,number FROM quotation_versions WHERE id=$1 FOR UPDATE':"SELECT p.id,v.number FROM cni_proposals p JOIN LATERAL(SELECT number FROM cni_proposal_versions WHERE proposal_id=p.id ORDER BY version DESC LIMIT 1)v ON true WHERE p.id=$1 FOR UPDATE OF p",[id])).rows[0];
  if(!document)throw new HttpError(404,'Quotation not found.');
  if(archived&&kind==='quotation'&&(await c.query("SELECT 1 FROM customer_purchase_orders WHERE quotation_id=$1 UNION ALL SELECT 1 FROM ipo_submissions WHERE input->>'quotationId'=$1::text UNION ALL SELECT 1 FROM internal_purchase_orders WHERE snapshot->>'quotationId'=$1::text LIMIT 1",[id])).rowCount)throw new HttpError(409,'This quotation is linked to a customer PO or IPO. Keep it in the project record.');
  const previous=(await c.query('SELECT archived FROM quotation_archives_current WHERE quotation_id=$1 OR cni_proposal_id=$1',[id])).rows[0];
  if(Boolean(previous?.archived)!==archived){
   await c.query('INSERT INTO quotation_archive_events(id,quotation_id,cni_proposal_id,archived,created_by) VALUES($1,$2,$3,$4,$5)',[randomUUID(),kind==='quotation'?id:null,kind==='cni'?id:null,archived,actor]);
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`quotation.${document.number}.${archived?'archived':'restored'}`]);
  }
  return {id,kind,number:document.number,archived};
 });
}
