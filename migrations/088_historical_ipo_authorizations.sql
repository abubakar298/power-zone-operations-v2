-- Director-approved historical references do not reset new-document counters.
CREATE TABLE historical_ipo_authorizations (
 record_id uuid PRIMARY KEY REFERENCES project_workflow_records(id),
 number text NOT NULL UNIQUE CHECK(length(number) BETWEEN 1 AND 100),
 source jsonb NOT NULL,
 approved_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_historical_ipo_authorization BEFORE UPDATE OR DELETE ON historical_ipo_authorizations FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
