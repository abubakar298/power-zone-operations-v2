-- Stage communication state only; business snapshots and delivery queues are not replayed.
CREATE TABLE operations_notification_incidents (
 id text PRIMARY KEY, site_id text NOT NULL REFERENCES operations_board_sites(id), stage_key text NOT NULL,
 occurrence_version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(site_id,stage_key,occurrence_version),
 FOREIGN KEY(site_id,occurrence_version) REFERENCES operations_board_versions(site_id,version)
);
CREATE TRIGGER immutable_operations_notification_incident BEFORE UPDATE OR DELETE ON operations_notification_incidents FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TABLE operations_notification_incident_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), incident_id text NOT NULL REFERENCES operations_notification_incidents(id),
 facts_sha256 text NOT NULL CHECK(facts_sha256 ~ '^[a-f0-9]{64}$'), facts jsonb NOT NULL,
 observed_at timestamptz NOT NULL, UNIQUE(incident_id,facts_sha256)
);
CREATE TRIGGER immutable_operations_notification_incident_observation BEFORE UPDATE OR DELETE ON operations_notification_incident_observations FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
-- Rebuildable current projection. Every meaningful fact set is retained above.
CREATE TABLE operations_notification_incident_state (
 site_id text PRIMARY KEY REFERENCES operations_board_sites(id), incident_id text REFERENCES operations_notification_incidents(id),
 stage_key text, occurrence_version integer, site_version integer NOT NULL,
 team text CHECK(team IN('central','south')), eligible_recipients uuid[] NOT NULL DEFAULT '{}',
 active boolean NOT NULL, facts_sha256 text NOT NULL, as_of timestamptz NOT NULL,
 FOREIGN KEY(site_id,site_version) REFERENCES operations_board_versions(site_id,version)
);
CREATE TABLE operations_notification_incident_intents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), incident_id text NOT NULL REFERENCES operations_notification_incidents(id),
 user_id uuid NOT NULL REFERENCES users(id), audience text NOT NULL, route_version integer NOT NULL,
 policy_version integer NOT NULL REFERENCES operations_notification_policy_versions(version),
 trigger text NOT NULL CHECK(trigger IN('delay','blocker')), tier text NOT NULL CHECK(tier IN('assigned','lead','management','head')),
 reference text NOT NULL, target jsonb NOT NULL, created_at timestamptz NOT NULL,
 UNIQUE(incident_id,user_id),
 FOREIGN KEY(audience,user_id,route_version) REFERENCES operations_notification_route_versions(audience,user_id,version)
);
CREATE TRIGGER immutable_operations_notification_incident_intent BEFORE UPDATE OR DELETE ON operations_notification_incident_intents FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE VIEW operations_notification_eligible_incident_intents AS
 SELECT i.*,n.site_id FROM operations_notification_incident_intents i
 JOIN operations_notification_incidents n ON n.id=i.incident_id
 JOIN operations_notification_incident_state s ON s.incident_id=i.incident_id AND s.active AND i.user_id=ANY(s.eligible_recipients)
 JOIN LATERAL(SELECT version,snapshot FROM operations_board_versions WHERE site_id=n.site_id ORDER BY version DESC LIMIT 1) current_site ON current_site.version=s.site_version
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
ALTER VIEW notification_events RENAME TO before_operations_incident_events;
CREATE VIEW notification_events AS SELECT * FROM before_operations_incident_events
 UNION ALL
 SELECT 'operations-notice:'||i.id,'operations-incident:'||i.incident_id,
 'Operations site alert',i.reference,NULL::uuid,i.created_at,i.user_id,'assigned',i.target,false
 FROM operations_notification_eligible_incident_intents i;
INSERT INTO notification_types(kind,title,email_enabled) VALUES('Operations site alert','Operations site requires attention',true);
