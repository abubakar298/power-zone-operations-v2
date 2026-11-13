-- A reconciliation correction alert is closed by recording who resolved it, when and how.
-- The alert itself is never edited or deleted; resolved alerts simply leave the open list.
CREATE TABLE ubl_documentation_alert_resolutions (
 alert_id text PRIMARY KEY REFERENCES ubl_documentation_alerts(id),
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 3 AND 2000),
 resolved_by uuid NOT NULL REFERENCES users(id),
 resolved_at timestamptz NOT NULL DEFAULT now(),
 request_key uuid NOT NULL UNIQUE
);
CREATE TRIGGER immutable_ubl_documentation_alert_resolution BEFORE UPDATE OR DELETE ON ubl_documentation_alert_resolutions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
