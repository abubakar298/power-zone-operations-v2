-- Operator-run, Director-authorised local workflow imports only; no automatic data import.
CREATE TABLE local_workflow_import_receipts (
 source_sha256 text PRIMARY KEY CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 source_metadata jsonb NOT NULL, original_workflows jsonb NOT NULL,
 imported_keys jsonb NOT NULL, identity_mapping jsonb NOT NULL, verification jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_local_workflow_import_receipt BEFORE UPDATE OR DELETE ON local_workflow_import_receipts FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
