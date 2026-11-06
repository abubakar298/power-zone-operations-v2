-- Director requested recoverable archive of the two explicitly identified demo submissions.
-- Preserve every immutable source row; exclude only these exact identities from active interfaces.
WITH target AS (
 SELECT s.* FROM ipo_submissions s
 WHERE s.id IN ('f7ecce6c-32bf-4224-b4bc-9c5d7b3ea8fe'::uuid,'6d25165e-3626-4a1f-966b-dd4beae2d694'::uuid)
 AND s.snapshot->>'quotationNumber'='Q-DEMO-S-001-R0-V2'
 AND s.snapshot->>'siteName'='s'
 AND NOT EXISTS(SELECT 1 FROM internal_purchase_orders i WHERE i.submission_id=s.id)
)
INSERT INTO test_workflow_archives(key,cutoff,counts,records)
SELECT 'LOCAL-REVIEW-SAMPLES-DEMO-IPO-DIRECTOR-2026-10-15',now(),
 jsonb_build_object('ipoSubmissions',count(*)),
 jsonb_build_object('reason','Director requested archive of the two Q-DEMO-S-001-R0-V2 demo IPO submissions',
 'localPreviewDocumentIds',jsonb_agg(id::text),'ipoSubmissions',jsonb_agg(to_jsonb(target)))
FROM target HAVING count(*)>0
ON CONFLICT(key) DO NOTHING;
