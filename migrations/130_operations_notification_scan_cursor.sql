-- One derived keyset cursor replaces repeated per-site polling writes.
-- Existing incidents, observations, recipients and business records remain untouched.
CREATE TABLE operations_notification_scan_cursor (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 after_site_id text, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO operations_notification_scan_cursor(singleton) VALUES(true);
-- Target changes invalidate queued incident visibility immediately, before the
-- bounded projector reaches every affected site. Recompute facts before sending.
CREATE OR REPLACE VIEW operations_notification_eligible_incident_intents AS
 SELECT i.*,n.site_id FROM operations_notification_incident_intents i
 JOIN operations_notification_incidents n ON n.id=i.incident_id
 JOIN operations_notification_incident_state s ON s.incident_id=i.incident_id AND s.active AND i.user_id=ANY(s.eligible_recipients)
 JOIN LATERAL(SELECT version,snapshot FROM operations_board_versions WHERE site_id=n.site_id ORDER BY version DESC LIMIT 1) current_site ON current_site.version=s.site_version
 JOIN operations_notification_incident_observations observation ON observation.incident_id=s.incident_id AND observation.facts_sha256=s.facts_sha256
  AND (observation.facts->>'targetVersion') IS NOT DISTINCT FROM (SELECT version::text FROM operations_board_target_versions ORDER BY version DESC LIMIT 1)
 JOIN operations_notification_policy_current p ON p.enabled
 JOIN operations_notification_policy_versions original_policy ON original_policy.version=i.policy_version AND p.activated_at<=original_policy.activated_at
 JOIN users policy_reviewer ON policy_reviewer.id=p.reviewed_by AND policy_reviewer.active AND policy_reviewer.role IN('Admin','Management')
 JOIN operations_notification_routes_current r ON r.audience=i.audience AND r.user_id=i.user_id AND r.active
 JOIN users route_reviewer ON route_reviewer.id=r.reviewed_by AND route_reviewer.active AND route_reviewer.role IN('Admin','Management')
 JOIN users u ON u.id=i.user_id AND u.active
 LEFT JOIN operations_board_access a ON a.user_id=u.id
 WHERE (i.audience='management' AND u.role IN('Admin','Management'))
 OR (i.audience='operations-head' AND u.role='Operations' AND a.kind='head')
 OR (i.audience='central-operations' AND u.role='Operations' AND a.kind='lead' AND a.team='central' AND current_site.snapshot->>'operationsTeam'='central')
 OR (i.audience='south-operations' AND u.role='Operations' AND a.kind='lead' AND a.team='south' AND current_site.snapshot->>'operationsTeam'='south')
 OR (i.audience='central-qc' AND u.role='Operations' AND a.kind='qc' AND a.team='central' AND current_site.snapshot->>'operationsTeam'='central')
 OR (i.audience='south-qc' AND u.role='Operations' AND a.kind='qc' AND a.team='south' AND current_site.snapshot->>'operationsTeam'='south');
