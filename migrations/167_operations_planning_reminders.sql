-- IPO planning alerts for solar sites (solar, solar + BESS) only. Additive communication state only; site snapshots are not changed.
-- A site waiting for "Team & vendor assignment" must be planned within 48 working hours
-- (Monday to Friday, Pakistan time); after that a "Planning pending" alert repeats every
-- 12 working hours until it is planned. The timing is worked out by the server.
CREATE TABLE operations_planning_reminder_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 activated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO operations_planning_reminder_settings(singleton) VALUES(true);
CREATE TABLE operations_planning_reminders (
 id text PRIMARY KEY, site_id text NOT NULL REFERENCES operations_board_sites(id),
 started_key text NOT NULL, sequence integer NOT NULL CHECK(sequence>=0), due_at timestamptz NOT NULL,
 reference text NOT NULL CHECK(length(reference) BETWEEN 1 AND 1000), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(site_id,started_key,sequence)
);
CREATE TRIGGER immutable_operations_planning_reminder BEFORE UPDATE OR DELETE ON operations_planning_reminders FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
-- Only the latest reminder of a still-unplanned site is live; recipients are the Operations
-- heads and the leads of the site's team (every lead while no team is chosen yet).
CREATE VIEW operations_planning_reminder_events AS
 SELECT 'planning-reminder:'||r.id||':'||u.id AS source_key,'planning-reminder:'||r.site_id AS entity_key,
 'Planning pending'::text AS kind,r.reference,NULL::uuid AS actor_id,r.created_at,u.id AS owner_id,'assigned'::text AS audience,
 jsonb_build_object('path','/operations/sites/'||r.site_id) AS target,false AS actionable
 FROM operations_planning_reminders r
 JOIN LATERAL(SELECT snapshot FROM operations_board_versions WHERE site_id=r.site_id ORDER BY version DESC LIMIT 1) s ON true
 JOIN operations_board_access a ON a.kind='head' OR (a.kind='lead' AND (NULLIF(s.snapshot->>'operationsTeam','') IS NULL OR a.team=s.snapshot->>'operationsTeam'))
 JOIN users u ON u.id=a.user_id AND u.active AND u.role='Operations'
 WHERE s.snapshot->>'stage'='received' AND s.snapshot->>'projectType' IN('solar','solar-bess') AND COALESCE(s.snapshot->>'stageStartedAt',s.snapshot->>'receivedAt')=r.started_key
 AND NULLIF(s.snapshot->>'dispatchDate','') IS NULL AND CASE WHEN jsonb_typeof(s.snapshot->'planningBatches')='array' THEN jsonb_array_length(s.snapshot->'planningBatches')=0 ELSE true END
 AND r.sequence=(SELECT max(x.sequence) FROM operations_planning_reminders x WHERE x.site_id=r.site_id AND x.started_key=r.started_key);
CREATE OR REPLACE VIEW notification_events AS
 SELECT * FROM before_workflow_handoff_events e WHERE NOT(
 e.source_key LIKE 'accounts:%' AND EXISTS(
  SELECT 1 FROM workflow_handoff_policy_current p JOIN internal_purchase_orders i ON i.id::text=e.target->>'ipo_id'
  WHERE p.enabled AND e.created_at>=p.activated_at AND i.created_at>=p.activated_at
 ))
 UNION ALL SELECT * FROM workflow_handoff_events
 UNION ALL SELECT * FROM operations_planning_reminder_events;
INSERT INTO notification_types(kind,title,email_enabled) VALUES('Planning pending','IPO planning pending',false) ON CONFLICT(kind) DO NOTHING;
