-- Revised POs for issued jobs are additive documents, never replacement financial snapshots.
CREATE TABLE project_order_amendments (
 id uuid PRIMARY KEY, record_id uuid NOT NULL REFERENCES project_workflow_records(id),
 receipt_id uuid UNIQUE NOT NULL REFERENCES project_po_receipts(id),
 decision_id uuid NOT NULL REFERENCES project_order_decisions(id),
 ipo_id uuid REFERENCES internal_purchase_orders(id), legacy_site_id integer REFERENCES ubl_site_orders(site_id),
 original_ipo_reference text NOT NULL, document_id uuid UNIQUE NOT NULL REFERENCES project_workflow_documents(id),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ipo_id IS NOT NULL OR legacy_site_id IS NOT NULL)
);
CREATE TRIGGER immutable_project_order_amendments BEFORE UPDATE OR DELETE ON project_order_amendments FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

CREATE OR REPLACE VIEW notification_events AS
SELECT * FROM legacy_notification_events
UNION ALL
SELECT 'project:'||e.id,'project:'||r.id,
 CASE WHEN e.snapshot->>'stage'='order_exception' THEN 'Order exception' WHEN e.action='handoff' THEN 'Design handoff' WHEN e.action='advance' THEN 'Advance planning' WHEN e.snapshot->>'stage'='issued' THEN 'IPO issued' ELSE 'Workflow action' END,
 concat_ws(' | ',c.short_code,r.site_name,r.site_code),e.created_by,e.created_at,
 CASE WHEN e.action='advance' THEN p.operations_owner_id WHEN e.action='handoff' THEN r.coordinator_id WHEN e.snapshot->>'stage' IN('survey_requested','survey_scheduled','report_received') THEN r.planning_owner_id WHEN e.snapshot->>'stage' IN('technical_review','technical_revision') THEN r.technical_owner_id ELSE r.coordinator_id END,
 CASE WHEN e.snapshot->>'stage'='order_exception' THEN 'management' WHEN e.snapshot->>'stage'='issued' THEN 'Accounts' ELSE 'assigned' END,
 CASE WHEN e.action='advance' THEN jsonb_build_object('url','/api/project-workflow/'||r.id||'/documents/'||p.document_id||'/pdf')
 WHEN e.snapshot->>'stage'='issued' AND e.snapshot->'data'->>'amendmentId' IS NOT NULL THEN jsonb_build_object('url','/api/project-workflow/'||r.id||'/documents/'||(e.snapshot->'data'->>'amendmentId')||'/pdf')
 WHEN e.snapshot->>'stage'='issued' THEN jsonb_build_object('target','finance','kind','IPO issued','ipo_id',e.snapshot->'data'->>'ipoId','id',e.snapshot->'data'->>'ipoId')
 ELSE jsonb_build_object('target',CASE WHEN e.snapshot->>'stage' IN('survey_requested','survey_scheduled','report_received','technical_review','technical_revision') THEN 'design' ELSE 'coordination' END,'kind','Project workflow','workflow_id',r.id,'id',r.id) END,
 e.snapshot->>'stage' NOT IN('issued','declined')
FROM project_workflow_events e JOIN project_workflow_records r ON r.id=e.record_id JOIN customers c ON c.id=r.customer_id LEFT JOIN project_advance_planning p ON p.record_id=r.id
WHERE e.id=(SELECT n.id FROM project_workflow_events n WHERE n.record_id=r.id ORDER BY n.version DESC LIMIT 1);
