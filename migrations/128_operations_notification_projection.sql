-- Additive, disabled-by-default communication projection. No business/stock/payment mutation.
CREATE TABLE operations_notification_policy_versions (
 version integer PRIMARY KEY CHECK(version>0), enabled boolean NOT NULL,
 activated_at timestamptz, reviewed_by uuid REFERENCES users(id),
 reason text NOT NULL CHECK(length(btrim(reason))>0), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT enabled OR (activated_at IS NOT NULL AND reviewed_by IS NOT NULL))
);
INSERT INTO operations_notification_policy_versions(version,enabled,reason) VALUES(1,false,'Deployment starts with Operations notification projection disabled.');
CREATE TRIGGER immutable_operations_notification_policy BEFORE UPDATE OR DELETE ON operations_notification_policy_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE VIEW operations_notification_policy_current AS SELECT * FROM operations_notification_policy_versions ORDER BY version DESC LIMIT 1;
CREATE TABLE operations_notification_route_versions (
 audience text NOT NULL CHECK(audience IN('operations-head','central-operations','south-operations','central-qc','south-qc','management','accounts')),
 user_id uuid NOT NULL REFERENCES users(id), version integer NOT NULL CHECK(version>0), active boolean NOT NULL,
 reviewed_by uuid NOT NULL REFERENCES users(id), reason text NOT NULL CHECK(length(btrim(reason))>0), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(audience,user_id,version)
);
CREATE TRIGGER immutable_operations_notification_route BEFORE UPDATE OR DELETE ON operations_notification_route_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE VIEW operations_notification_routes_current AS SELECT DISTINCT ON(audience,user_id) * FROM operations_notification_route_versions ORDER BY audience,user_id,version DESC;
CREATE TABLE operations_notification_intents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES operations_board_events(id),
 user_id uuid NOT NULL REFERENCES users(id), audience text NOT NULL,
 route_version integer NOT NULL, policy_version integer NOT NULL REFERENCES operations_notification_policy_versions(version),
 reference text NOT NULL, target jsonb NOT NULL CHECK(jsonb_typeof(target)='object'),
 kind text NOT NULL CHECK(kind IN('Operations handoff','Operations correction')),
 created_at timestamptz NOT NULL, projected_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,user_id),
 FOREIGN KEY(audience,user_id,route_version) REFERENCES operations_notification_route_versions(audience,user_id,version)
);
CREATE TRIGGER immutable_operations_notification_intent BEFORE UPDATE OR DELETE ON operations_notification_intents FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
-- Rechecked by projection, list and sender: a retained notification never grants site access.
CREATE VIEW operations_notification_eligible_intents AS
 SELECT i.*,e.site_id,e.created_by AS actor_id
 FROM operations_notification_intents i
 JOIN operations_board_events e ON e.id=i.event_id
 JOIN operations_board_versions source ON source.site_id=e.site_id AND source.version=e.site_version
 JOIN LATERAL(SELECT snapshot FROM operations_board_versions WHERE site_id=e.site_id ORDER BY version DESC LIMIT 1) current_site ON true
 JOIN operations_notification_policy_current policy ON policy.enabled AND e.created_at>=policy.activated_at
 JOIN users policy_reviewer ON policy_reviewer.id=policy.reviewed_by AND policy_reviewer.active AND policy_reviewer.role IN('Admin','Management')
 JOIN operations_notification_routes_current r ON r.audience=i.audience AND r.user_id=i.user_id AND r.active
 JOIN users route_reviewer ON route_reviewer.id=r.reviewed_by AND route_reviewer.active AND route_reviewer.role IN('Admin','Management')
 JOIN users u ON u.id=i.user_id AND u.active
 LEFT JOIN operations_board_access a ON a.user_id=u.id
 WHERE (i.audience='management' AND u.role IN('Admin','Management'))
 OR (i.audience='accounts' AND u.role='Accounts')
 OR (i.audience='operations-head' AND u.role='Operations' AND a.kind='head')
 OR (i.audience='central-operations' AND u.role='Operations' AND a.kind='lead' AND a.team='central' AND source.snapshot->>'operationsTeam'='central' AND current_site.snapshot->>'operationsTeam'='central')
 OR (i.audience='central-qc' AND u.role='Operations' AND a.kind='qc' AND a.team='central' AND source.snapshot->>'operationsTeam'='central' AND current_site.snapshot->>'operationsTeam'='central')
 OR (i.audience='south-qc' AND u.role='Operations' AND a.kind='qc' AND a.team='south' AND source.snapshot->>'operationsTeam'='south' AND current_site.snapshot->>'operationsTeam'='south')
 OR (i.audience='south-operations' AND u.role='Operations' AND a.kind='lead' AND a.team='south' AND source.snapshot->>'operationsTeam'='south' AND current_site.snapshot->>'operationsTeam'='south');
ALTER VIEW notification_events RENAME TO before_operations_projection_events;
CREATE VIEW notification_events AS
 SELECT * FROM before_operations_projection_events
 UNION ALL
 SELECT 'operations-notice:'||i.id,'operations-notice:'||i.id,i.kind,i.reference,i.actor_id,i.created_at,
 i.user_id,'assigned',i.target,false
 FROM operations_notification_eligible_intents i;
INSERT INTO notification_types(kind,title,email_enabled) VALUES
 ('Operations handoff','Operations handoff',true),('Operations correction','Operations decision corrected',true);
