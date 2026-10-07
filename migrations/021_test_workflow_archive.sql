-- Operator-only recovery archive for the owner's explicitly confirmed test documents.
-- Normal migrations never remove or archive active workflow data.
CREATE TABLE test_workflow_archives (
 key text PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 cutoff timestamptz NOT NULL,
 counts jsonb NOT NULL,
 records jsonb NOT NULL
);
CREATE TRIGGER immutable_test_workflow_archive BEFORE UPDATE OR DELETE ON test_workflow_archives FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
