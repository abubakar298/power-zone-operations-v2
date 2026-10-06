import type { Pool } from "pg";
export class CoordinatorRepository {
  constructor(private pool: Pool) {}
  async overview(actor: string, team: boolean) {
    const pending = `WITH pending AS (
 SELECT d.id,'Survey / BOQ'::text AS kind,COALESCE(d.inputs->>'siteName','Survey draft') AS reference,COALESCE(d.inputs->>'siteName','') AS site,CASE WHEN s.id IS NULL THEN 'Draft' WHEN s.outcome IS NULL THEN 'Awaiting review' ELSE 'Changes requested' END AS status,d.updated_at AS started_at,'boqs'::text AS target,d.id AS draft_id,NULL::uuid AS boq_revision_id,NULL::uuid AS ipo_id,NULL::uuid AS request_id
 FROM survey_drafts d LEFT JOIN LATERAL (SELECT r.id,c.outcome FROM boq_review_submissions r LEFT JOIN boq_review_decisions c ON c.submission_id=r.id WHERE r.draft_id=d.id ORDER BY r.created_at DESC LIMIT 1) s ON true
 WHERE ($2 OR d.owner_id=$1) AND NOT EXISTS(SELECT 1 FROM quotation_revision_requests r WHERE r.draft_id=d.id) AND NOT EXISTS(SELECT 1 FROM boq_draft_finalizations f WHERE f.draft_id=d.id)
 UNION ALL
 SELECT b.id,'Commercial pricing',b.number,b.snapshot->'survey'->>'siteName','Approved BOQ: prepare pricing',b.created_at,'pricing',NULL,b.id,NULL,NULL FROM boq_revisions b
 WHERE ($2 OR EXISTS(SELECT 1 FROM boq_draft_finalizations f JOIN survey_drafts d ON d.id=f.draft_id WHERE f.revision_id=b.id AND d.owner_id=$1)) AND NOT EXISTS(SELECT 1 FROM boq_revisions n WHERE n.boq_id=b.boq_id AND n.revision>b.revision) AND NOT EXISTS(SELECT 1 FROM commercial_pricing_versions p WHERE p.boq_revision_id=b.id)
 UNION ALL
 SELECT p.id,'Quotation',p.number,p.snapshot->>'siteName','Pricing saved: prepare quotation',p.created_at,'quotes',NULL,NULL,NULL,NULL FROM commercial_pricing_versions p WHERE ($2 OR p.created_by=$1) AND NOT EXISTS(SELECT 1 FROM commercial_pricing_versions n WHERE n.boq_revision_id=p.boq_revision_id AND n.version>p.version) AND NOT EXISTS(SELECT 1 FROM quotation_versions q WHERE q.pricing_id=p.id)
 UNION ALL
 SELECT r.id,'Quotation revision',q.number,q.snapshot->>'siteName',CASE WHEN r.costing_change AND f.revision_id IS NULL THEN 'BOQ revision required' ELSE 'Commercial revision required' END,r.created_at,CASE WHEN r.costing_change AND f.revision_id IS NULL THEN 'boqs' ELSE 'pricing' END,CASE WHEN f.revision_id IS NULL THEN r.draft_id ELSE NULL END,COALESCE(f.revision_id,q.boq_revision_id),NULL,r.id FROM quotation_revision_requests r JOIN quotation_versions q ON q.id=r.source_quotation_id LEFT JOIN boq_draft_finalizations f ON f.draft_id=r.draft_id WHERE ($2 OR r.created_by=$1) AND NOT EXISTS(SELECT 1 FROM quotation_revision_links l WHERE l.request_id=r.id)
 UNION ALL
 SELECT q.id,'Sale confirmation',q.number,q.snapshot->>'siteName','Awaiting PO / sale confirmation',q.created_at,'orders',NULL,NULL,NULL,NULL FROM quotation_versions q WHERE ($2 OR q.created_by=$1) AND NOT EXISTS(SELECT 1 FROM quotation_versions n WHERE n.boq_revision_id=q.boq_revision_id AND n.version>q.version) AND NOT EXISTS(SELECT 1 FROM customer_purchase_orders p WHERE p.quotation_id=q.id) AND NOT EXISTS(SELECT 1 FROM ipo_submissions s WHERE s.input->>'quotationId'=q.id::text) AND NOT EXISTS(SELECT 1 FROM quotation_revision_requests r WHERE r.source_quotation_id=q.id)
 UNION ALL
 SELECT s.id,'IPO evidence',s.snapshot->>'quotationNumber',s.snapshot->>'siteName','Awaiting evidence approval',s.created_at,'orders',NULL,NULL,NULL,NULL FROM ipo_submissions s WHERE ($2 OR s.created_by=$1) AND NOT EXISTS(SELECT 1 FROM internal_purchase_orders i WHERE i.submission_id=s.id)
 UNION ALL
 SELECT i.id,'Operations issuance',i.number,i.snapshot->>'siteName','Send approved BOQ to Operations',i.created_at,'operations',NULL,NULL,i.id,NULL FROM internal_purchase_orders i LEFT JOIN ipo_submissions s ON s.id=i.submission_id WHERE ($2 OR i.created_by=$1 OR s.created_by=$1) AND NOT EXISTS(SELECT 1 FROM operations_boq_issuances o WHERE o.ipo_id=i.id)
 )`;
    const result = (
      await this.pool.query(
        `${pending} SELECT (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM (SELECT * FROM pending ORDER BY started_at,id LIMIT 200) t) AS tasks,(SELECT COUNT(*)::integer FROM pending) AS total,(SELECT COALESCE(jsonb_object_agg(kind,n),'{}'::jsonb) FROM (SELECT kind,COUNT(*)::integer n FROM pending GROUP BY kind) c) AS counts`,
        [actor, team],
      )
    ).rows[0];
    const activity = (
      await this.pool.query(
        `SELECT
 (SELECT COUNT(*)::integer FROM boq_revisions b WHERE b.created_at>=now()-interval '30 days' AND ($2 OR EXISTS(SELECT 1 FROM boq_draft_finalizations f JOIN survey_drafts d ON d.id=f.draft_id WHERE f.revision_id=b.id AND d.owner_id=$1))) AS boqs,
 (SELECT COUNT(*)::integer FROM quotation_versions WHERE created_at>=now()-interval '30 days' AND ($2 OR created_by=$1)) AS quotations,
 (SELECT COUNT(*)::integer FROM internal_purchase_orders i LEFT JOIN ipo_submissions s ON s.id=i.submission_id WHERE i.created_at>=now()-interval '30 days' AND ($2 OR i.created_by=$1 OR s.created_by=$1)) AS ipos,
 (SELECT COUNT(*)::integer FROM operations_boq_issuances WHERE created_at>=now()-interval '30 days' AND ($2 OR created_by=$1)) AS handoffs`,
        [actor, team],
      )
    ).rows[0];
    return { ...result, activity, scope: team ? "team" : "mine" };
  }
}
