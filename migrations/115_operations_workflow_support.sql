ALTER TABLE operations_board_versions ADD COLUMN request_sha256 text CHECK(request_sha256 IS NULL OR request_sha256 ~ '^[a-f0-9]{64}$');
CREATE TABLE operations_board_vendor_versions (
 vendor_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 request_key uuid NOT NULL UNIQUE,
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 reason text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(vendor_id,version)
);
CREATE TRIGGER immutable_operations_board_vendor BEFORE UPDATE OR DELETE ON operations_board_vendor_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TABLE operations_board_target_versions (
 version integer PRIMARY KEY CHECK(version>0),
 values jsonb NOT NULL CHECK(jsonb_typeof(values)='object'),
 request_key uuid NOT NULL UNIQUE,
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 reason text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_operations_board_targets BEFORE UPDATE OR DELETE ON operations_board_target_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
-- Target changes notify Management only; Moaz's alert list excludes them.
CREATE TABLE operations_board_target_events (
 version integer PRIMARY KEY REFERENCES operations_board_target_versions(version),
 audiences jsonb NOT NULL DEFAULT '["management"]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_operations_board_target_event BEFORE UPDATE OR DELETE ON operations_board_target_events FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
