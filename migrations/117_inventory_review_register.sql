-- Reviewed historical evidence and decisions only. No stock/financial posting.
CREATE TABLE inventory_review_access (
 user_id uuid NOT NULL REFERENCES users(id),
 capability text NOT NULL CHECK(capability IN ('reviewer','approver')),
 granted_by uuid NOT NULL REFERENCES users(id),
 reason text NOT NULL CHECK(length(btrim(reason))>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,capability)
);
CREATE TABLE inventory_review_sources (
 source_sha256 text PRIMARY KEY CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 catalogue_sha256 text NOT NULL CHECK(catalogue_sha256 ~ '^[a-f0-9]{64}$'),
 metadata jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE inventory_review_cases (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'),
 source_sha256 text NOT NULL REFERENCES inventory_review_sources(source_sha256),
 source_row jsonb NOT NULL CHECK(jsonb_typeof(source_row)='object'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE inventory_review_versions (
 case_id text NOT NULL REFERENCES inventory_review_cases(id),
 version integer NOT NULL CHECK(version>0),
 state text NOT NULL CHECK(state IN ('source-verified','needs-review','proposed','clarification','approved-awaiting-posting')),
 proposal jsonb,
 reason text NOT NULL,
 request_key uuid NOT NULL,
 request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(case_id,version), UNIQUE(case_id,request_key)
);
CREATE INDEX inventory_review_latest ON inventory_review_versions(case_id,version DESC);
CREATE TRIGGER immutable_inventory_review_source BEFORE UPDATE OR DELETE ON inventory_review_sources FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_inventory_review_case BEFORE UPDATE OR DELETE ON inventory_review_cases FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_inventory_review_version BEFORE UPDATE OR DELETE ON inventory_review_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
