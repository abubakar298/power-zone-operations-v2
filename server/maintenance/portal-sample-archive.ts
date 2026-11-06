import type {Pool,PoolClient} from 'pg';
import {HttpError} from '../http/errors.js';

export const portalSampleArchiveKey='LOCAL-REVIEW-SAMPLES-20261102-OWNER-PORTAL-CLEANUP';
const cutoff='2026-11-02T18:56:12Z';
/** Owner's 2 November cleanup. Exact confirmed master identities; never classify real jobs by a loose text search. */
export async function portalSampleArchivePlan(c:Pool|PoolClient){
 const customers=(await c.query("SELECT * FROM customers WHERE (id=0 AND name='Demo Sites') OR (id BETWEEN 286 AND 305 AND name ~ '^SAMPLE Customer [0-9]{2}$') OR (id=344 AND name='Bhai Bhai Oil') ORDER BY id")).rows;
 const customerIds=customers.map(r=>String(r.id));
 const sites=(await c.query("SELECT * FROM sites WHERE customer_id::text=ANY($1::text[]) OR (id=225 AND customer_id=1 AND code='JBWARE' AND name='JB Warehouse') ORDER BY id",[customerIds])).rows;
 const siteIds=sites.map(r=>String(r.id));
 const roots=(await c.query('SELECT id,draft_id FROM boqs WHERE customer_id::text=ANY($1::text[]) OR site_id::text=ANY($2::text[])',[customerIds,siteIds])).rows;
 const boqIds=roots.map(r=>r.id),ids=new Set<string>(boqIds),counts:Record<string,number>={customers:customers.length,sites:sites.length,boqs:roots.length};
 const collect=async(table:string,sql:string,args:unknown[])=>{const rows=(await c.query(sql,args)).rows;counts[table]=rows.length;for(const r of rows){if(r.created_at&&new Date(r.created_at)>new Date(cutoff))throw new HttpError(409,'Sample archive stopped: newer documents require a fresh review.');ids.add(String(r.id));}return rows.map(r=>String(r.id));};
 const drafts=await collect('survey_drafts',"SELECT id,created_at FROM survey_drafts WHERE inputs->>'customerId'=ANY($1::text[]) OR id=ANY($2::uuid[]) OR (inputs->>'customerId'='1' AND upper(inputs->>'siteCode')='JBWARE')",[customerIds,roots.map(r=>r.draft_id)]);
 const revisions=await collect('boq_revisions','SELECT id,created_at FROM boq_revisions WHERE boq_id=ANY($1::uuid[])',[boqIds]);
 await collect('commercial_pricing_versions','SELECT id,created_at FROM commercial_pricing_versions WHERE boq_revision_id=ANY($1::uuid[])',[revisions]);
 await collect('quotation_versions','SELECT id,created_at FROM quotation_versions WHERE boq_revision_id=ANY($1::uuid[])',[revisions]);
 await collect('ipo_submissions',"SELECT id,created_at FROM ipo_submissions WHERE snapshot->>'boqRevisionId'=ANY($1::text[])",[revisions]);
 const ipos=await collect('internal_purchase_orders',"SELECT id,created_at FROM internal_purchase_orders WHERE snapshot->>'boqRevisionId'=ANY($1::text[])",[revisions]);
 await collect('operations_boq_issuances','SELECT id,created_at FROM operations_boq_issuances WHERE boq_revision_id=ANY($1::uuid[])',[revisions]);
 const proposals=await collect('cni_proposals','SELECT id,created_at FROM cni_proposals WHERE customer_id::text=ANY($1::text[])',[customerIds]);
 await collect('cni_proposal_versions','SELECT id,created_at FROM cni_proposal_versions WHERE proposal_id=ANY($1::uuid[])',[proposals]);
 const workflows=await collect('project_workflow_records','SELECT id,created_at FROM project_workflow_records WHERE customer_id::text=ANY($1::text[]) OR site_id::text=ANY($2::text[])',[customerIds,siteIds]);
 await collect('project_workflow_documents','SELECT id,created_at FROM project_workflow_documents WHERE record_id=ANY($1::uuid[])',[workflows]);
 const boards=(await c.query("SELECT site_id FROM (SELECT DISTINCT ON(site_id) site_id,snapshot FROM operations_board_versions ORDER BY site_id,version DESC) b WHERE snapshot#>>'{origin,ipoId}'=ANY($1::text[])",[ipos])).rows.map(r=>r.site_id);
 counts.operationsSites=boards.length;
 return {key:portalSampleArchiveKey,cutoff,counts,records:{customerMasters:customers,siteMasters:sites,portalCustomerIds:customerIds,portalSiteIds:siteIds,portalOperationSiteIds:boards,localPreviewDocumentIds:[...ids],draftIds:drafts,scope:'Owner-confirmed demos, SAMPLE customers, Bhai Bhai Oil and PowerZone JB Warehouse. No deletion, financial or stock changes.'}};
}
/** Operator-only, explicitly called after review; no migration/startup hook or automatic cleanup. All originals remain intact. */
export async function archivePortalSamples(pool:Pool,actor:string){
 const c=await pool.connect();try{
 await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='5s'");await c.query('SELECT pg_advisory_xact_lock(742019022)');
 const user=(await c.query('SELECT active,role FROM users WHERE id=$1 FOR SHARE',[actor])).rows[0];
 if(!user?.active||!['Admin','Management'].includes(user.role))throw new HttpError(403,'Management access required.');
 const existing=(await c.query('SELECT counts FROM test_workflow_archives WHERE key=$1',[portalSampleArchiveKey])).rows[0];
 if(existing){await c.query('COMMIT');return existing.counts;}
 const plan=await portalSampleArchivePlan(c);
 await c.query('INSERT INTO test_workflow_archives(key,cutoff,counts,records) VALUES($1,$2,$3,$4)',[plan.key,plan.cutoff,plan.counts,{...plan.records,actor}]);
 await c.query('COMMIT');return plan.counts;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
