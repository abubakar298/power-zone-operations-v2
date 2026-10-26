CREATE TABLE workflow_revision_source_rules (
 version integer PRIMARY KEY, customer_short_code text NOT NULL, route text NOT NULL,
 rule jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO workflow_revision_source_rules VALUES(1,'UBL','survey-framework','{"source":"saved-technical-inputs-and-exact-approved-framework","quotationRequired":false,"retainFrozenRates":true,"retainFinancialHistory":true}',now());
CREATE TRIGGER immutable_revision_source_rule BEFORE UPDATE OR DELETE ON workflow_revision_source_rules FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TABLE framework_revision_sources (
 id uuid PRIMARY KEY,record_id uuid NOT NULL REFERENCES project_workflow_records(id),record_version integer NOT NULL,
 framework_id uuid NOT NULL REFERENCES project_framework_versions(id),boq_revision_id uuid NOT NULL REFERENCES boq_revisions(id),
 rule_version integer NOT NULL REFERENCES workflow_revision_source_rules(version),snapshot jsonb NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(record_id,record_version)
);
CREATE TRIGGER immutable_framework_revision_source BEFORE UPDATE OR DELETE ON framework_revision_sources FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TABLE framework_revision_requests (
 id uuid PRIMARY KEY,source_id uuid NOT NULL REFERENCES framework_revision_sources(id),route text NOT NULL CHECK(route IN('technical','commercial')),
 origin text NOT NULL,reason text NOT NULL,requested_by text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),draft_id uuid REFERENCES survey_drafts(id),request_key uuid UNIQUE NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_framework_revision_request BEFORE UPDATE OR DELETE ON framework_revision_requests FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
