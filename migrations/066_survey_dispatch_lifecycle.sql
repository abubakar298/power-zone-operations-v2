ALTER TABLE survey_dispatches ADD COLUMN creation_key uuid UNIQUE;
ALTER TABLE survey_dispatches ADD COLUMN closed_at timestamptz;
ALTER TABLE survey_dispatches ADD COLUMN closed_by uuid REFERENCES users(id);
ALTER TABLE survey_dispatches ADD COLUMN closure_reason text;
CREATE TABLE survey_dispatch_events (
 id uuid PRIMARY KEY,
 dispatch_id uuid NOT NULL REFERENCES survey_dispatches(id),
 action text NOT NULL,
 snapshot jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_survey_dispatch_event BEFORE UPDATE OR DELETE ON survey_dispatch_events FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
