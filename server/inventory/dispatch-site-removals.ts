import type {Pool,PoolClient} from 'pg';
import {dispatchReconciliationEligibleSql} from './dispatch-reconciliation-eligibility.js';

export type DispatchSiteRemoval={
 dispatchId:string;
 siteId:string;
 number:string;
 batchNumber:string;
 removedAt:string;
};

/** The matching Operations site and batch revisions share a request key. Use the
 * prior stop and its exact Inventory references so a later plan cannot relabel an
 * earlier trip. A batch deletion is a separate action for correcting plans.
 */
export async function readDispatchSiteRemovals(db:Pool|PoolClient,dispatchIds:string[]):Promise<DispatchSiteRemoval[]>{
 if(!dispatchIds.length)return [];
 const {rows}=await db.query<DispatchSiteRemoval>(`
  WITH dispatch_sites AS (
   SELECT d.id,d.number,d.draft_id,d.created_at,d.snapshot,s->>'siteId' site_id,s->>'registeredSiteId' board_id, s->>'dispatchDate' scheduled_date
   FROM inventory_material_dispatches_active d
   CROSS JOIN LATERAL jsonb_array_elements(d.snapshot->'sites') s
   WHERE d.id=ANY($1::uuid[]) AND ${dispatchReconciliationEligibleSql}
     AND nullif(s->>'registeredSiteId','') IS NOT NULL
  )
  SELECT DISTINCT ON (d.id,d.site_id)
   d.id AS "dispatchId",d.site_id AS "siteId",d.number,
   decision.number AS "batchNumber",removed.created_at::text AS "removedAt"
  FROM dispatch_sites d
  JOIN operations_board_versions removed ON removed.site_id=d.board_id AND removed.action='Batch site cancelled'
  JOIN operations_board_batch_versions decision ON decision.request_key=removed.request_key
   AND decision.created_by=removed.created_by AND decision.request_sha256=removed.request_sha256
  JOIN operations_board_batch_versions prior ON prior.batch_id=decision.batch_id AND prior.version=decision.version-1
  JOIN LATERAL jsonb_array_elements(prior.snapshot->'stops') stop ON stop->>'siteId'=d.board_id
  WHERE coalesce(stop->>'kind',prior.snapshot->>'kind') IN ('delivery','both')
   AND prior.snapshot->>'deliveryDate' IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(decision.snapshot->'stops') kept WHERE kept->>'siteId'=d.board_id)
   AND upper(d.number)=ANY(regexp_split_to_array(
    upper(btrim(coalesce(prior.snapshot->>'inventoryReference','')||
      CASE WHEN decision.snapshot->>'deliveryDate'=prior.snapshot->>'deliveryDate'
           THEN ' '||coalesce(decision.snapshot->>'inventoryReference','') ELSE '' END)),
    '[[:space:],;/·]+'))
   AND (d.scheduled_date IS NULL OR d.scheduled_date=prior.snapshot->>'deliveryDate')
   AND d.created_at<=removed.created_at
   AND EXISTS(SELECT 1 FROM inventory_warehouse_operational_movements m
    WHERE m.dispatch_id=d.id AND m.kind='dispatch-out' AND m.created_at<=removed.created_at)
   AND NOT EXISTS(SELECT 1 FROM inventory_gate_pass_copies g
    WHERE g.document_kind='dispatch' AND g.document_id=d.id
     AND (g.copy_kind='signed-customer' OR (g.copy_kind='customer-signoff' AND g.source_site_id::text=d.site_id)))
   AND NOT EXISTS(SELECT 1 FROM inventory_gate_pass_copies g
    JOIN inventory_material_dispatches_active individual ON individual.id=g.document_id
    WHERE d.snapshot->>'parent'='true' AND g.document_kind='dispatch' AND g.copy_kind='signed-customer'
     AND individual.snapshot->>'parent'='false'
     AND individual.snapshot->'sites' @> jsonb_build_array(jsonb_build_object('registeredSiteId',d.board_id))
     AND (g.created_at AT TIME ZONE 'Asia/Karachi')::date::text BETWEEN prior.snapshot->>'deliveryDate' AND (removed.created_at AT TIME ZONE 'Asia/Karachi')::date::text)
   AND NOT EXISTS(SELECT 1 FROM inventory_material_site_usage_versions u
    WHERE u.site_id::text=d.site_id AND (u.draft_id=d.draft_id
     OR u.draft_id::text=d.snapshot#>>'{combinedPlan,fixedDraftId}'
     OR u.draft_id::text=d.snapshot#>>'{combinedPlan,variableDraftId}')
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(u.snapshot->'lines','[]')) used
     JOIN inventory_material_dispatch_lines_active l ON l.dispatch_id=d.id AND l.line_key::text=used->>'lineKey'))
   -- Protect archived versions as well as current evidence. An unscoped
   -- delivery or completion dated within this trip is ambiguous.
   AND NOT EXISTS(
    SELECT 1 FROM operations_board_versions evidence
    WHERE evidence.site_id=d.board_id AND (
     EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(nullif(evidence.snapshot->'deliveries','null'::jsonb),'[]'::jsonb)) delivery
      WHERE delivery->>'dispatchId'=d.id::text OR
       (delivery->>'deliveryDate'>=prior.snapshot->>'deliveryDate'
        AND delivery->>'deliveryDate'<=(removed.created_at AT TIME ZONE 'Asia/Karachi')::date::text
        AND (nullif(delivery->>'dispatchId','') IS NULL OR
         coalesce(d.snapshot->>'parent','false')='true')))
     OR (evidence.snapshot->>'signedDo' IS NOT NULL
      AND coalesce(nullif(evidence.snapshot->'deliveries','null'::jsonb),'[]'::jsonb)='[]'::jsonb
      AND evidence.snapshot->>'deliveryDate' BETWEEN prior.snapshot->>'deliveryDate' AND (removed.created_at AT TIME ZONE 'Asia/Karachi')::date::text)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(nullif(evidence.snapshot->'documents','null'::jsonb),'[]'::jsonb)) doc
      WHERE doc->>'id' IN (d.board_id||':historical-delivery-documents',d.board_id||':historical-handover-documents')
       AND (coalesce(doc->>'evidenceDate',doc->>'date') IS NULL OR coalesce(doc->>'evidenceDate',doc->>'date') BETWEEN prior.snapshot->>'deliveryDate' AND (removed.created_at AT TIME ZONE 'Asia/Karachi')::date::text))
     OR coalesce(evidence.snapshot#>>'{qcJob,date}',evidence.snapshot#>>'{qc,signoff,date}',evidence.snapshot#>>'{qc,handover,date}') BETWEEN prior.snapshot->>'deliveryDate' AND (removed.created_at AT TIME ZONE 'Asia/Karachi')::date::text
    )
   )
  ORDER BY d.id,d.site_id,removed.created_at DESC
 `,[[...new Set(dispatchIds)]]);
 return rows;
}

/** Usage is saved per preparation/site/line. Waive it only when every issue
 * of that line on the preparation matches the removal for that site.
 */
export function removedSitesForLine(removals:DispatchSiteRemoval[],dispatchIds:string[],siteIds:string[]){
 return dispatchIds.length?siteIds.filter(siteId=>dispatchIds.every(dispatchId=>
  removals.some(removal=>removal.dispatchId===dispatchId&&removal.siteId===siteId))):[];
}
