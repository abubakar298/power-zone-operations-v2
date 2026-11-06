CREATE TABLE survey_dispatches (
 id uuid PRIMARY KEY,
 sequence integer GENERATED ALWAYS AS IDENTITY UNIQUE,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE survey_dispatch_previews (
 id uuid PRIMARY KEY,
 dispatch_id uuid NOT NULL REFERENCES survey_dispatches(id),
 snapshot jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_survey_dispatch_preview BEFORE UPDATE OR DELETE ON survey_dispatch_previews FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TABLE survey_dispatch_approvals (
 preview_id uuid PRIMARY KEY REFERENCES survey_dispatch_previews(id),
 approved_by uuid NOT NULL REFERENCES users(id),
 approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_survey_dispatch_approval BEFORE UPDATE OR DELETE ON survey_dispatch_approvals FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TABLE survey_dispatch_sites (
 record_id uuid PRIMARY KEY REFERENCES project_workflow_records(id),
 dispatch_id uuid NOT NULL REFERENCES survey_dispatches(id)
);
