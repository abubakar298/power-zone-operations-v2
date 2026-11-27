import type { Pool } from 'pg';
import { transaction } from '../db/transaction.js';
import { linkCreatedOperationsMaterialSource } from './source-links.js';

/** Recover issued no-PO handoffs that the previous PO rule left in the queue.
 * Reuse the same write and validation as new handoffs; concurrent or repeated
 * runs retain the original source link. Never create a dispatch or move stock. */
export async function backfillNoPoMaterialSources(pool: Pool) {
  const { rows } = await pool.query<{
    boardSiteId: string; ipoId: string; operationsIssuanceId: string; actorId: string;
  }>(`
    WITH latest AS (
      SELECT DISTINCT ON(site_id) site_id,snapshot
      FROM operations_board_versions ORDER BY site_id,version DESC
    )
    SELECT b.site_id AS "boardSiteId",i.id AS "ipoId",
           o.id AS "operationsIssuanceId",u.id AS "actorId"
    FROM latest b
    JOIN internal_purchase_orders i ON i.id::text=b.snapshot#>>'{origin,ipoId}'
    JOIN operations_boq_issuances o ON o.ipo_id=i.id
      AND o.id::text=b.snapshot#>>'{origin,operationsIssuanceId}'
    JOIN site_workflow w ON w.ipo_id=i.id AND w.issuance_id=o.id
      AND w.id::text=b.snapshot#>>'{origin,legacyWorkflowId}'
    JOIN users u ON u.id=o.created_by AND u.active
    WHERE b.snapshot#>>'{origin,kind}'='live-ipo-handoff'
      AND b.snapshot->>'stage' IN ('received','awaiting')
      AND w.stage<>'closed' AND w.delivered_on IS NULL
      AND i.snapshot->'historicalImport' IS NULL
      AND coalesce(btrim(i.snapshot#>>'{input,poNumber}'),'')=''
      AND coalesce(btrim(b.snapshot->>'customerPo'),'')=''
      AND NOT EXISTS(SELECT 1 FROM inventory_material_source_links l
                     WHERE l.ipo_id=i.id OR l.board_site_id=b.site_id)
    ORDER BY i.number,i.id
  `);
  let linked=0;
  for(const {actorId,...handoff} of rows){
    const result=await transaction(pool,c=>linkCreatedOperationsMaterialSource(c,actorId,handoff));
    if(result.status==='linked')linked++;
  }
  return linked;
}
