-- Security work (Moaz, 24 Oct 2026): Procurement access managed by Admin with an immutable record, sign-out after
-- inactivity, password re-entry before money approvals, and a security log. Nothing existing is changed or removed;
-- 101's name-based procurement grants stay exactly as they were.

-- Procurement access granted and removed by Admin, by exact email. Every change is kept.
CREATE TABLE procurement_access_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id),
 capability text NOT NULL CHECK (capability IN ('buyer','approver')),
 action text NOT NULL CHECK (action IN ('grant','remove')),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
 actor uuid NOT NULL REFERENCES users(id),
 ip text NOT NULL DEFAULT '',
 device text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX procurement_access_events_time ON procurement_access_events(created_at DESC);
CREATE TRIGGER immutable_procurement_access_events BEFORE UPDATE OR DELETE ON procurement_access_events
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

-- Sessions remember the last real activity (background refreshes excluded) and the last password re-entry.
ALTER TABLE auth_sessions ADD COLUMN last_activity_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth_sessions ADD COLUMN reauth_at timestamptz;

-- Security log: sign-ins, failures and lockouts; views and exports of prices and costs; approvals; access changes;
-- backup downloads. Admin reads it; nobody can change or delete it.
CREATE TABLE security_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK (length(kind) BETWEEN 3 AND 60),
 -- No foreign key: the log outlives a deleted account and never blocks deleting one.
 user_id uuid,
 email text NOT NULL DEFAULT '',
 detail text NOT NULL DEFAULT '',
 method text NOT NULL DEFAULT '',
 path text NOT NULL DEFAULT '',
 status integer,
 ip text NOT NULL DEFAULT '',
 device text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_time ON security_events(created_at DESC);
CREATE INDEX security_events_user ON security_events(user_id, created_at DESC);
CREATE INDEX security_events_kind ON security_events(kind, created_at DESC);
CREATE TRIGGER immutable_security_events BEFORE UPDATE OR DELETE ON security_events
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
