-- Inventory installation reports; no stock movements, invoicing or job closure.
CREATE TABLE inventory_reports (
 id uuid PRIMARY KEY, job_key text NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE inventory_report_versions (
 id uuid PRIMARY KEY, report_id uuid NOT NULL REFERENCES inventory_reports(id),
 version integer NOT NULL CHECK(version>0), stage text NOT NULL CHECK(stage IN('IRR Received','Draft Reconciliation','Sent to Accounts','Returned for Correction')),
 snapshot jsonb NOT NULL, request_key uuid NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(report_id,version)
);
CREATE TRIGGER immutable_inventory_report_version BEFORE UPDATE OR DELETE ON inventory_report_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TABLE inventory_report_files (
 id uuid PRIMARY KEY, report_id uuid NOT NULL REFERENCES inventory_reports(id),
 filename text NOT NULL, media_type text NOT NULL, content bytea NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(octet_length(content) BETWEEN 1 AND 8388608)
);
CREATE TRIGGER immutable_inventory_report_file BEFORE UPDATE OR DELETE ON inventory_report_files FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
