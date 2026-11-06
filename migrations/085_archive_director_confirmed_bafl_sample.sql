-- Explicit Director request, 2026-10-14: archive only the BAFL 7870 sample.
-- Retain every source row and snapshot; use the existing recoverable archive index.
WITH target AS (
 SELECT b.id,b.draft_id FROM quotation_versions q
 JOIN boq_revisions r ON r.id=q.boq_revision_id JOIN boqs b ON b.id=r.boq_id
 JOIN customers c ON c.id=b.customer_id
 WHERE q.id='ef44343e-aadf-44ff-9a8d-2db716378e7b'::uuid
 AND q.number='CPZ-QT-26-005-0003-004-R2 (BAFL-7870)'
 AND c.short_code='BAFL' AND q.snapshot->>'siteName'='7870'
), revisions AS (SELECT r.* FROM boq_revisions r JOIN target t ON t.id=r.boq_id),
pricing AS (SELECT p.* FROM commercial_pricing_versions p JOIN revisions r ON r.id=p.boq_revision_id),
quotations AS (SELECT q.* FROM quotation_versions q JOIN revisions r ON r.id=q.boq_revision_id),
ids AS (SELECT draft_id AS id FROM target UNION SELECT id FROM revisions UNION SELECT id FROM pricing UNION SELECT id FROM quotations)
INSERT INTO test_workflow_archives(key,cutoff,counts,records)
SELECT 'LOCAL-REVIEW-SAMPLES-BAFL-7870-DIRECTOR-2026-10-14',now(),
 jsonb_build_object('boqs',(SELECT count(*) FROM target),'quotations',(SELECT count(*) FROM quotations)),
 jsonb_build_object('reason','Director identified BAFL 7870 as a sample and requested recoverable archive',
 'localPreviewDocumentIds',(SELECT jsonb_agg(id::text) FROM ids),
 'boqRevisions',(SELECT jsonb_agg(to_jsonb(r)) FROM revisions r),
 'pricingVersions',(SELECT jsonb_agg(to_jsonb(p)) FROM pricing p),
 'quotationVersions',(SELECT jsonb_agg(to_jsonb(q)) FROM quotations q))
WHERE EXISTS(SELECT 1 FROM target)
ON CONFLICT(key) DO NOTHING;
