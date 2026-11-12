-- Operations head cancels a customer-cancelled site. The cancellation itself is a new
-- operations_board_versions row (cancelled=true) plus a 'Site cancelled' board event;
-- nothing saved is edited. This migration only adds the in-app notice and stops
-- planning reminders for cancelled sites. Forward-only: no historical replay.
INSERT INTO notification_types(kind,title,email_enabled) VALUES('Site cancelled','Site cancelled',false) ON CONFLICT(kind) DO NOTHING;
CREATE INDEX operations_board_events_site_cancelled ON operations_board_events(created_at) WHERE kind='Site cancelled';

CREATE OR REPLACE VIEW operations_planning_reminder_events AS
 SELECT 'planning-reminder:'||r.id||':'||u.id AS source_key,'planning-reminder:'||r.site_id AS entity_key,
 'Planning pending'::text AS kind,r.reference,NULL::uuid AS actor_id,r.created_at,u.id AS owner_id,'assigned'::text AS audience,
 jsonb_build_object('path','/operations/sites/'||r.site_id) AS target,false AS actionable
 FROM operations_planning_reminders r
 JOIN LATERAL(SELECT snapshot FROM operations_board_versions WHERE site_id=r.site_id ORDER BY version DESC LIMIT 1) s ON true
 JOIN operations_board_access a ON a.kind='head' OR (a.kind='lead' AND (NULLIF(s.snapshot->>'operationsTeam','') IS NULL OR a.team=s.snapshot->>'operationsTeam'))
 JOIN users u ON u.id=a.user_id AND u.active AND u.role='Operations'
 WHERE s.snapshot->>'stage'='received' AND s.snapshot->>'projectType' IN('solar','solar-bess') AND COALESCE(s.snapshot->>'stageStartedAt',s.snapshot->>'receivedAt')=r.started_key
 AND NULLIF(s.snapshot->>'dispatchDate','') IS NULL AND CASE WHEN jsonb_typeof(s.snapshot->'planningBatches')='array' THEN jsonb_array_length(s.snapshot->'planningBatches')=0 ELSE true END
 AND r.sequence=(SELECT max(x.sequence) FROM operations_planning_reminders x WHERE x.site_id=r.site_id AND x.started_key=r.started_key)
 AND s.snapshot->>'cancelled' IS DISTINCT FROM 'true';

-- One notice per department. Each audience has its own source key so a Management inbox
-- never shows the same cancellation twice. The actor is excluded by the notification sync.
ALTER VIEW notification_events RENAME TO before_operations_site_cancellation_events;
CREATE VIEW notification_events AS SELECT * FROM before_operations_site_cancellation_events
UNION ALL
SELECT 'site-cancelled:'||e.id||':'||r.audience,'site-cancelled:'||e.site_id,'Site cancelled',
 left(concat_ws(' | ',v.snapshot->>'ipo',(v.snapshot->>'name')||' was cancelled by '||coalesce(u.display_name,'Operations')||'. Reason: '||v.reason),1000),
 e.created_by,e.created_at,NULL::uuid,r.audience,
 CASE WHEN r.audience IN('management','Operations') THEN jsonb_build_object('path','/operations/sites/'||replace(replace(replace(e.site_id,'%','%25'),':','%3A'),'/','%2F'))
  WHEN r.audience='Inventory' THEN jsonb_build_object('target','inventory')
  WHEN r.audience='Accounts' THEN jsonb_build_object('target','finance','siteId',e.site_id)
  ELSE jsonb_build_object('target','dashboard') END,
 false
FROM operations_board_events e
JOIN operations_board_versions v ON v.site_id=e.site_id AND v.version=e.site_version
LEFT JOIN users u ON u.id=e.created_by
CROSS JOIN (VALUES('management'),('Operations'),('Inventory'),('Accounts'),('Coordinator')) r(audience)
WHERE e.kind='Site cancelled';
