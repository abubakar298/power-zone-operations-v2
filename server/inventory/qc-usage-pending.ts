import type {Pool} from 'pg';
import {Decimal} from 'decimal.js';
import {materialDocumentPolicy} from '../../shared/material-documents.js';
import {parentPoolLines} from '../../shared/parent-material-pool.js';
import {dispatchReconciliationEligibleSql} from './dispatch-reconciliation-eligibility.js';
import {historicalQcIssues,hasReviewedHistoricalIssues} from './historical-qc-issues.js';
import {historicalQcSiteNumber} from './historical-qc-usage.js';
import {qcDispatchQuantities,qcReviewedDispatches,qcReviewedDispatchIds} from './qc-dispatch-review.js';

const recorded=(value:unknown)=>value!==null&&value!==undefined&&value!=='';

/** Project the QC worklist from the same prepared lines and saved reports as Material Usage. */
export async function sitesAwaitingQcUsage(db:Pool,sites:{id:string;ipo:string}[]){
 const pending=new Set<string>();
 if(!sites.length)return pending;
 const ids=sites.map(s=>s.id);
 const {rows}=await db.query(`
  WITH preparations AS (
   SELECT d.id,v.snapshot
   FROM inventory_material_drafts d
   JOIN LATERAL (
    SELECT snapshot FROM inventory_material_draft_versions WHERE draft_id=d.id ORDER BY version DESC LIMIT 1
   ) v ON true
   WHERE v.snapshot->>'combinedPlan' IS NULL
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.snapshot->'sites') s WHERE s->>'registeredSiteId'=ANY($1::text[]))
  )
  SELECT p.snapshot, s->>'registeredSiteId' AS board_id, s->>'siteId' AS site_id, usage.snapshot AS usage,
   issued.lines AS issues
  FROM preparations p
  CROSS JOIN LATERAL jsonb_array_elements(p.snapshot->'sites') s
  LEFT JOIN LATERAL (
   SELECT snapshot FROM inventory_material_site_usage_versions
   WHERE draft_id=p.id AND site_id::text=s->>'siteId'
   ORDER BY version DESC LIMIT 1
  ) usage ON true
  CROSS JOIN LATERAL (
   SELECT jsonb_agg(jsonb_build_object('id',d.id,'key',l.line_key,'quantity',l.quantity::text,
    'eligible',${dispatchReconciliationEligibleSql})) AS lines
   FROM inventory_material_dispatches_active d
   JOIN inventory_material_dispatch_lines_active l ON l.dispatch_id=d.id
   WHERE (d.draft_id=p.id OR d.snapshot#>>'{combinedPlan,fixedDraftId}'=p.id::text
    OR d.snapshot#>>'{combinedPlan,variableDraftId}'=p.id::text)
    AND (${dispatchReconciliationEligibleSql} OR d.id=ANY($2::uuid[]))
  ) issued
  WHERE s->>'registeredSiteId'=ANY($1::text[])
 `,[ids,qcReviewedDispatches]);

 const withNativeUsage=new Set<string>();
 const withNativePreparation=new Set<string>();
 for(const row of rows){
  withNativePreparation.add(row.board_id);
  const reviewIds=qcReviewedDispatchIds(row.board_id);
  const quantities=new Map<string,Decimal>();
  for(const issue of (row.issues??[]) as {id:string;key:string;quantity:string;eligible:boolean}[]){
   if(issue.eligible||reviewIds.includes(issue.id)){
    quantities.set(issue.key,(quantities.get(issue.key)??new Decimal(0)).plus(issue.quantity));
   }
  }
  const stock:{key:string;quantity:string}[]=[],required:string[]=[];
  for(const line of parentPoolLines(row.snapshot) as {key:string;itemId:string;description:string;unit:string;out:string;sites:string[]}[]){
   if(!line.sites.includes(row.site_id)||!line.itemId||!line.unit)continue;
   const policy=materialDocumentPolicy(line);
   const quantity=quantities.get(line.key);
   if(!policy.approvedQuantityLocked&&quantity?.gt(0)){
    stock.push({key:line.key,quantity:quantity.toString()});
    required.push(line.key);
   }else if(policy.approvedQuantityLocked&&row.snapshot.kind==='fixed'&&line.out!==''){
    required.push(line.key);
   }
  }
  if(!required.length)continue;
  withNativeUsage.add(row.board_id);
  const report=row.usage;
  if(report?.state!=='signed'||(report.qcDispatchQuantities!==undefined&&report.qcDispatchQuantities!==qcDispatchQuantities(stock))||
   required.some(key=>!report.lines?.some((line:{lineKey:string;used:unknown})=>line.lineKey===key&&recorded(line.used)))){
   pending.add(row.board_id);
  }
 }

 const historical=sites.filter(site=>!withNativeUsage.has(site.id)&&(
  hasReviewedHistoricalIssues(site.id)||(!withNativePreparation.has(site.id)&&historicalQcSiteNumber(site.id))));
 if(!historical.length)return pending;
 const historicalIds=historical.map(site=>site.id);
 const [linked,legacy]=await Promise.all([
  db.query(`SELECT DISTINCT ON (site_id) site_id,snapshot FROM inventory_historical_qc_issue_usage
   WHERE site_id=ANY($1::text[]) ORDER BY site_id,version DESC`,[historicalIds]),
  db.query(`SELECT v.snapshot#>>'{qcUsage,boardId}' AS site_id FROM inventory_reports r
   JOIN LATERAL (SELECT stage,snapshot FROM inventory_report_versions WHERE report_id=r.id ORDER BY version DESC LIMIT 1) v ON true
   WHERE v.stage='Sent to Accounts' AND v.snapshot#>>'{qcUsage,input,verify}'='true'
    AND v.snapshot#>>'{qcUsage,boardId}'=ANY($1::text[])`,[historicalIds]),
 ]);
 const verified=new Set(legacy.rows.map(row=>row.site_id));
 const linkedReports=new Map(linked.rows.map(row=>[row.site_id,row.snapshot]));
 for(const site of historical){
  if(verified.has(site.id))continue;
  const source=historicalQcIssues(site.id,site.ipo);
  if(source?.lines.length){
   const report=linkedReports.get(site.id);
   if(report?.state!=='signed'||report.issueSignature!==source.signature||
    source.lines.some(line=>!recorded(report.usage?.[line.key])))pending.add(site.id);
  }else if(!hasReviewedHistoricalIssues(site.id)&&historicalQcSiteNumber(site.id)){
   pending.add(site.id);
  }
 }
 return pending;
}
