import {ipoSiteIdentity} from '../orders/site-identity.js';
import type {Pool} from 'pg';
import {Decimal} from 'decimal.js';
import {HttpError} from '../http/errors.js';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {transaction} from '../db/transaction.js';

/** Confirmed workflow issuances are authoritative; Accounts review is independent. */
export async function upsPortfolio(pool:Pool,actor:string,customer:'MBL'|'UBL'){
 const user=(await pool.query('SELECT active,role FROM users WHERE id=$1',[actor])).rows[0];
 if(!user?.active||!['Admin','Management'].includes(user.role))throw new HttpError(403,'Director reporting requires management access.');
 const issued=(await pool.query(`SELECT w.record_id,w.ipo_id,i.number,i.created_at,i.snapshot,p.basis,c.name AS customer,budget.snapshot AS management_budget,budget.version AS budget_version
 FROM project_workflow_issuances w
 JOIN project_workflow_records r ON r.id=w.record_id
 JOIN customers c ON c.id=r.customer_id
 JOIN project_po_receipts p ON p.id=w.receipt_id
 JOIN internal_purchase_orders i ON i.id=w.ipo_id
 LEFT JOIN LATERAL(SELECT snapshot,version FROM ups_management_budget_versions WHERE ipo_id=i.id ORDER BY version DESC LIMIT 1) budget ON true
 WHERE upper(c.short_code)=$1 AND r.route='direct-framework'
 AND p.basis->'source'->>'key' IN ($2,$3)
 AND r.data->>'localPreviewArchived' IS DISTINCT FROM 'true'
 ORDER BY i.created_at DESC,i.id`,[customer,`${customer}-UPS-6-5`,`${customer}-UPS-6-10`])).rows;
 for(const row of issued){const identity=await ipoSiteIdentity(pool,row);if(identity.snapshot)row.snapshot=identity.snapshot;}
 const program=(await pool.query("SELECT snapshot FROM ups_management_program_versions WHERE customer_code=$1 ORDER BY version DESC,created_at DESC LIMIT 1",[customer])).rows[0]?.snapshot??null;
 const scoped=program?issued.filter(r=>program.configurationKeys.includes(r.basis.source.key)&&String(r.snapshot.input.orderNumber??'').split('/')[1]===String(program.totalSites)):issued;
 const rows=scoped.map(r=>{
  const s=r.snapshot,net=new Decimal(s.allocation.subtotal),cost=new Decimal(r.management_budget?.total??r.basis.boq.total),profit=net.minus(cost);
  return {budgetVersion:r.budget_version??null,id:r.ipo_id,recordId:r.record_id,number:r.number,customer:r.customer,site:s.siteName,siteCode:s.siteCode,configuration:r.basis.source.key.replace(`${customer}-UPS-`,''),orderNumber:s.input.orderNumber??'',approvalDate:s.input.orderDate,confirmationType:s.input.evidenceType,issuedAt:r.created_at,
   sellingExGst:net.toFixed(2),gst:new Decimal(s.allocation.tax).toFixed(2),payable:new Decimal(s.allocation.total).toFixed(2),budgetedCost:cost.toFixed(2),budgetedProfit:profit.toFixed(2),markupPercent:cost.gt(0)?profit.div(cost).mul(100).toFixed(2):null};
 });
 const sum=(key:string)=>rows.reduce((n,r)=>n.add((r as any)[key]),new Decimal(0)).toFixed(2);
 const closures=(await pool.query(`SELECT j.snapshot FROM (SELECT DISTINCT ON(job_key) job_key,stage,snapshot FROM accounts_active_job_closures WHERE job_key=ANY($1::text[]) ORDER BY job_key,version DESC)j WHERE j.stage='Closed'`,[rows.map(r=>'ipo:'+r.id)])).rows;
 const actualSelling=closures.reduce((n,r)=>n.add(r.snapshot.summary.selling),new Decimal(0)),actualCost=closures.reduce((n,r)=>n.add(r.snapshot.summary.actual),new Decimal(0)),actualProfit=actualSelling.sub(actualCost);
 return {customer,program,rows,actual:{sites:closures.length,sellingExGst:closures.length?actualSelling.toFixed(2):null,cost:closures.length?actualCost.toFixed(2):null,markup:closures.length?actualProfit.toFixed(2):null,markupPercent:actualCost.gt(0)?actualProfit.div(actualCost).mul(100).toFixed(2):null},totals:{orders:rows.length,payable:sum('payable'),sellingExGst:sum('sellingExGst'),gst:sum('gst'),budgetedCost:sum('budgetedCost'),budgetedProfit:sum('budgetedProfit')}};
}

/** Append a separate Management baseline; never update original costing or issued PDFs. */
export async function saveUpsManagementBudget(pool:Pool,actor:string,ipoId:string,rates:Record<string,string>,notes:string){
 return transaction(pool,async c=>{
  const u=(await c.query('SELECT active,role FROM users WHERE id=$1',[actor])).rows[0];
  if(!u?.active||!['Admin','Management'].includes(u.role))throw new HttpError(403,'Director reporting requires management access.');
  if(!notes.trim())throw new HttpError(400,'Record the budget change reason.');
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['ups-budget:'+ipoId]);
  const source=(await c.query(`SELECT p.basis,i.snapshot FROM project_workflow_issuances w JOIN project_po_receipts p ON p.id=w.receipt_id JOIN internal_purchase_orders i ON i.id=w.ipo_id WHERE i.id=$1`,[ipoId])).rows[0];
  if(!source||source.basis.order.allocation.policy!=='fixed-bank-ups')throw new HttpError(422,'Select a confirmed bank UPS order.');
  const allowed=['CH-PCS-HYB-SP-006','CH-BMS-LV','CH-BAT-LV-05 KW'];
  if(Object.keys(rates).some(id=>!allowed.includes(id)))throw new HttpError(400,'Only the agreed UPS component budgets can be changed.');
  const previous=(await c.query('SELECT version,snapshot FROM ups_management_budget_versions WHERE ipo_id=$1 ORDER BY version DESC LIMIT 1',[ipoId])).rows[0];
  const lines=structuredClone(previous?.snapshot.lines??source.basis.boq.lines);
  for(const [id,rate]of Object.entries(rates)){
   if(!/^\d+(?:\.\d{1,4})?$/.test(rate))throw new HttpError(400,'Enter a non-negative budget rate.');
   const matches=lines.filter((l:any)=>l.itemId===id);if(matches.length!==1)throw new HttpError(422,'Budget component is missing or ambiguous.');
   matches[0].rate=rate;matches[0].total=new Decimal(rate).mul(matches[0].qty).toFixed(2);
  }
  const snapshot={source:'Management approved budget',lines,total:lines.reduce((n:Decimal,l:any)=>n.add(l.total),new Decimal(0)).toFixed(2),issuedCost:source.basis.boq.total};
  if(previous&&isDeepStrictEqual(previous.snapshot,snapshot))return {version:previous.version,snapshot:previous.snapshot};
  const version=(previous?.version??0)+1,id=randomUUID();
  await c.query('INSERT INTO ups_management_budget_versions(id,ipo_id,version,snapshot,notes,created_by) VALUES($1,$2,$3,$4,$5,$6)',[id,ipoId,version,snapshot,notes,actor]);
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`ups.management-budget:${ipoId}:v${version}:${notes}`]);
  return {version,snapshot};
 });
}
