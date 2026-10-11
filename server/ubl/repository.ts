import type {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {CommercialRepository} from '../commercial/repository.js';
import {MastersRepository} from '../masters/repository.js';
import {fingerprint} from '../boq/repository.js';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';
import {canSeeBessCost} from '../http/cost-visibility.js';
import {ublBudget,type UblConfiguration} from './engine.js';

export class UblRepository {
 constructor(private pool:Pool){}
 async closedJobs(actor:string){
  await this.role(actor);
  const rows=(await this.pool.query(`SELECT j.id,j.snapshot,j.created_at,o.site_name,o.branch_code,o.configuration_id,o.legacy_ipo_number,to_char(j.created_at AT TIME ZONE 'Asia/Karachi','YYYY-MM-DD') AS closed_date FROM (SELECT DISTINCT ON(job_key) * FROM accounts_job_closures ORDER BY job_key,version DESC) j JOIN ubl_effective_site_orders o ON j.job_key='ubl:'||o.site_id WHERE j.stage='Closed' ORDER BY j.created_at DESC`)).rows;
  return {jobs:rows.map(r=>({id:r.id,siteName:r.site_name,branchCode:r.branch_code,configuration:r.configuration_id,ipoNumber:r.legacy_ipo_number,closedDate:r.closed_date,sellingValue:r.snapshot.summary.selling,actualCost:r.snapshot.summary.actual,budgetedMarkup:r.snapshot.summary.budgetedMarkup,budgetedMarkupPercent:r.snapshot.summary.budgetedMarkupPercent,actualMarkup:r.snapshot.summary.actualMarkup,actualMarkupPercent:r.snapshot.summary.actualMarkupPercent})),closureWorkflowAvailable:true};
 }
 async sites(actor:string){
  await this.role(actor);
  return (await this.pool.query('SELECT o.*,o.po_issued_date::text AS po_issued_date FROM ubl_effective_site_orders o ORDER BY source_row')).rows;
 }
 async role(actor:string,write=false,c:Pool=this.pool){
  await new CommercialRepository(this.pool).manager(c,actor,!write);
  const role=(await c.query('SELECT role FROM users WHERE id=$1',[actor])).rows[0].role as string;
  if(!['Admin','Management'].includes(role))throw new HttpError(403,'UBL Solar is available to Administrator and Management only.');
  return role;
 }
 async list(actor:string){
  await this.role(actor);
  return (await this.pool.query(`SELECT c.id,c.customer_id,c.source,t.version,t.snapshot->>'pvWatts' AS pv_watts,t.snapshot->>'inverterKw' AS inverter_kw,t.snapshot->>'essKwh' AS ess_kwh,h.snapshot->>'totalIncludingGst' AS fixed_total,h.snapshot->>'panelSellingExcludingGst' AS panel_selling,(SELECT max(b.version) FROM ubl_budget_versions b WHERE b.configuration_id=c.id) AS budget_version FROM ubl_configurations c JOIN ubl_technical_versions t ON t.configuration_id=c.id AND t.version=(SELECT max(v.version) FROM ubl_technical_versions v WHERE v.configuration_id=c.id) JOIN ubl_commercial_history h ON h.configuration_id=c.id AND h.stage='Revised' ORDER BY c.id`)).rows;
 }
 async detail(actor:string,id:string){
  const role=await this.role(actor),configuration=(await this.pool.query('SELECT * FROM ubl_configurations WHERE id=$1',[id])).rows[0];
  if(!configuration)throw new HttpError(404,'UBL configuration not found.');
  let technical=(await this.pool.query('SELECT version,snapshot,effective_date,notes FROM ubl_technical_versions WHERE configuration_id=$1 ORDER BY version',[id])).rows;
  let history=(await this.pool.query('SELECT h.stage,h.agreed_date,h.snapshot,b.total_cost AS budgeted_cost,b.panel_rate,b.basis AS cost_basis FROM ubl_commercial_history h LEFT JOIN ubl_effective_history_costs b ON b.configuration_id=h.configuration_id AND b.stage=h.stage WHERE h.configuration_id=$1 ORDER BY h.agreed_date',[id])).rows;
  let budgets=(await this.pool.query('SELECT b.*,u.display_name AS created_by_name FROM ubl_budget_versions b JOIN users u ON u.id=b.created_by WHERE configuration_id=$1 ORDER BY version DESC',[id])).rows;
  if(!canSeeBessCost(role)){
   technical=technical.map(t=>({...t,snapshot:{id:t.snapshot.id,rows:t.snapshot.rows,pvWatts:t.snapshot.pvWatts,inverterKw:t.snapshot.inverterKw,essKwh:t.snapshot.essKwh,source:t.snapshot.source,amendments:t.snapshot.amendments}}));
   history=history.map(h=>{const {historicalSummaryBudget,...snapshot}=h.snapshot;return {...h,snapshot};});
   budgets=budgets.map(b=>({...b,notes:'Management budget refresh',snapshot:{configuration:b.snapshot.configuration,technicalVersion:b.snapshot.technicalVersion,costingDate:b.snapshot.costingDate,fixedAgreedTotal:b.snapshot.fixedAgreedTotal,panel:b.snapshot.panel,rows:b.snapshot.rows.filter((r:any)=>r.category!=='bess'),issues:b.snapshot.issues,costVisibility:'Excluding BESS',allocationStatus:b.snapshot.allocation.status}}));
  }
  return {configuration,technical,history,budgets,canRefresh:canSeeBessCost(role)};
 }
 async refresh(actor:string,id:string,expectedVersion:number,requestKey:string,notes:string){
  return transaction(this.pool,async c=>{
   await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
   await this.role(actor,true,c as unknown as Pool);
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`ubl-budget:${id}`]);
   const old=(await c.query('SELECT * FROM ubl_budget_versions WHERE request_key=$1',[requestKey])).rows[0];
   if(old){if(old.configuration_id!==id||old.created_by!==actor||old.notes!==notes)throw new HttpError(409,'This refresh request belongs to different inputs.');return old;}
   const technical=(await c.query('SELECT snapshot FROM ubl_technical_versions WHERE configuration_id=$1 ORDER BY version DESC LIMIT 1',[id])).rows[0];
   if(!technical)throw new HttpError(404,'UBL configuration not found.');
   const latest=Number((await c.query('SELECT COALESCE(max(version),0) AS version FROM ubl_budget_versions WHERE configuration_id=$1',[id])).rows[0].version);
   if(latest!==expectedVersion)throw new HttpError(409,'A newer budget exists. Reload the configuration before refreshing.');
   const masters=await new MastersRepository(c as unknown as Pool,true).list();
   const policy=await new CommercialRepository(this.pool).standardPolicy(actor,c);
   const snapshot=ublBudget(technical.snapshot as UblConfiguration,masters,policy),uuid=randomUUID();
   const row=(await c.query('INSERT INTO ubl_budget_versions(id,configuration_id,version,technical_version,snapshot,fingerprint,request_key,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[uuid,id,latest+1,snapshot.technicalVersion,snapshot,fingerprint(snapshot),requestKey,notes,actor])).rows[0];
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`ubl.${id}.budget.v${latest+1}.created`]);
   return row;
  }).catch(error=>{
   if(error?.code==='23505'||error?.code==='40001')throw new HttpError(409,'A concurrent budget refresh completed. Reload the configuration before refreshing.');
   throw error;
  });
 }
 async source(actor:string,id:string){
  await this.role(actor);
  const row=(await this.pool.query('SELECT filename,sha256,content FROM ubl_source_documents WHERE configuration_id=$1',[id])).rows[0];
  if(!row)throw new HttpError(404,'Source proposal not found.');return row;
 }
}
