-- Complete the same Director-authorized recoverable archive for the workflow wrapper.
WITH target AS (
 SELECT w.* FROM project_workflow_records w JOIN customers c ON c.id=w.customer_id
 WHERE c.short_code='BAFL' AND w.site_code='7870' AND w.site_name='7870'
 AND w.route='quick-quote' AND w.stage='design_handed_off'
 AND EXISTS(SELECT 1 FROM test_workflow_archives WHERE key='LOCAL-REVIEW-SAMPLES-BAFL-7870-DIRECTOR-2026-10-14')
), saved AS (
 INSERT INTO test_workflow_archives(key,cutoff,counts,records)
 SELECT 'LOCAL-REVIEW-SAMPLES-BAFL-7870-WORKFLOW-2026-10-14',now(),jsonb_build_object('projects',count(*)),
 jsonb_build_object('reason','Director-confirmed BAFL 7870 sample; workflow wrapper archived with quotation',
 'projectWorkflowRecords',jsonb_agg(to_jsonb(target)),'localPreviewDocumentIds','[]'::jsonb)
 FROM target HAVING count(*)=1 ON CONFLICT(key) DO NOTHING RETURNING key
)
UPDATE project_workflow_records w SET data=w.data||jsonb_build_object('localPreviewArchived',true,'localArchiveKey','LOCAL-REVIEW-SAMPLES-BAFL-7870-WORKFLOW-2026-10-14')
WHERE w.id IN(SELECT (r->>'id')::uuid FROM test_workflow_archives a CROSS JOIN LATERAL jsonb_array_elements(a.records->'projectWorkflowRecords') r WHERE a.key='LOCAL-REVIEW-SAMPLES-BAFL-7870-WORKFLOW-2026-10-14')
OR (w.id IN(SELECT id FROM target) AND EXISTS(SELECT 1 FROM saved));
