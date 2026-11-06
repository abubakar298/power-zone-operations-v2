-- Preserve existing notification sources and add metadata-only workflow handoffs.
ALTER VIEW notification_events RENAME TO legacy_notification_events;
CREATE VIEW notification_events AS
SELECT * FROM legacy_notification_events
UNION ALL
SELECT 'project:'||e.id,'project:'||r.id,
 CASE WHEN e.snapshot->>'stage'='order_exception' THEN 'Order exception' WHEN e.action='handoff' THEN 'Design handoff' WHEN e.action='advance' THEN 'Advance planning' WHEN e.snapshot->>'stage'='issued' THEN 'IPO issued' ELSE 'Workflow action' END,
 concat_ws(' | ',c.short_code,r.site_name,r.site_code),e.created_by,e.created_at,
 CASE WHEN e.action='advance' THEN p.operations_owner_id WHEN e.action='handoff' THEN r.coordinator_id WHEN e.snapshot->>'stage' IN('survey_requested','survey_scheduled') THEN r.planning_owner_id WHEN e.snapshot->>'stage' IN('technical_review','technical_revision') THEN r.technical_owner_id ELSE r.coordinator_id END,
 CASE WHEN e.snapshot->>'stage'='order_exception' THEN 'management' WHEN e.snapshot->>'stage'='issued' THEN 'Accounts' ELSE 'assigned' END,
 jsonb_build_object('target','coordination','kind','Project workflow','workflow_id',r.id,'id',r.id),
 e.snapshot->>'stage' NOT IN('issued','declined')
FROM project_workflow_events e JOIN project_workflow_records r ON r.id=e.record_id JOIN customers c ON c.id=r.customer_id LEFT JOIN project_advance_planning p ON p.record_id=r.id
WHERE e.id=(SELECT n.id FROM project_workflow_events n WHERE n.record_id=r.id ORDER BY n.version DESC LIMIT 1);

INSERT INTO notification_types(kind,title,email_enabled) VALUES
('Order exception','PO exception requires Management review',false),('Design handoff','Design output ready for Coordination',false),('Advance planning','Advance planning request received',false),('IPO issued','IPO issued to Accounts',false),('Workflow action','Project workflow action required',false) ON CONFLICT DO NOTHING;
