import type { Pool } from "pg";

// Read only frozen document snapshots; current master values never alter history.
export async function workflowHistory(pool: Pool, revisionId: string) {
  return (
    await pool.query(
      `WITH RECURSIVE lineage AS (
            SELECT b.*,ARRAY[b.id] AS visited FROM boq_revisions b WHERE b.id=$1
            UNION ALL
            SELECT b.*,l.visited || b.id FROM lineage l
            JOIN boq_draft_finalizations f ON f.revision_id=l.id
            JOIN survey_drafts d ON d.id=f.draft_id
            JOIN boq_revisions b ON b.id=d.base_revision_id
            WHERE NOT b.id=ANY(l.visited)
          ) SELECT l.id,l.number,l.revision,l.created_at,l.revision_reason,l.revision_origin,
            l.snapshot->>'total' AS budgeted_cost,
            COALESCE(l.snapshot->'survey'->>'sourceMode','Survey') AS survey_type,
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id',q.id,'number',q.number,'quoted_at',q.created_at,
              'revision',(SELECT jsonb_build_object('origin',r.origin,'reason',r.reason) FROM quotation_revision_links k JOIN quotation_revision_requests r ON r.id=k.request_id WHERE k.quotation_id=q.id),
              'net_total',(SELECT entry->>'amount' FROM jsonb_array_elements(q.snapshot->'footer') entry WHERE entry->>'label'='Net Total' LIMIT 1),
              'status',COALESCE((SELECT e.kind FROM coordination_events e WHERE e.quotation_id=q.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1),'Not submitted')
            ) ORDER BY q.version) FROM quotation_versions q WHERE q.boq_revision_id=l.id),'[]'::jsonb) AS quotations
          FROM lineage l ORDER BY l.revision,l.created_at`,
      [revisionId],
    )
  ).rows;
}
