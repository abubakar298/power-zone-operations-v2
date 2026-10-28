-- Additive operational records. No stock, financial or historical source postings.
CREATE TABLE operations_board_access (
 user_id uuid PRIMARY KEY REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('head','lead','qc')),
 team text CHECK(team IN ('central','south')),
 granted_by uuid NOT NULL REFERENCES users(id),
 granted_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='head' AND team IS NULL) OR (kind<>'head' AND team IS NOT NULL))
);
CREATE TABLE operations_board_sites (
 id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 160),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE operations_board_versions (
 site_id text NOT NULL REFERENCES operations_board_sites(id),
 version integer NOT NULL CHECK(version>0),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 action text NOT NULL,
 reason text NOT NULL,
 request_key uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(site_id,version), UNIQUE(site_id,request_key)
);
CREATE TABLE operations_board_files (
 id uuid PRIMARY KEY,
 site_id text NOT NULL REFERENCES operations_board_sites(id),
 filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 200),
 media_type text NOT NULL CHECK(media_type IN ('application/pdf','image/png','image/jpeg')),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 content bytea NOT NULL CHECK(octet_length(content)>0 AND octet_length(content)<=8388608),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(site_id,sha256)
);
CREATE TRIGGER immutable_operations_board_site BEFORE UPDATE OR DELETE ON operations_board_sites FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_operations_board_version BEFORE UPDATE OR DELETE ON operations_board_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_operations_board_file BEFORE UPDATE OR DELETE ON operations_board_files FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE INDEX operations_board_versions_latest ON operations_board_versions(site_id,version DESC);
-- Transactional handoff facts for the subsequent notification/email projector.
-- Importing historical rows does not generate handoff events or email blasts.
CREATE TABLE operations_board_events (
 id uuid PRIMARY KEY,
 site_id text NOT NULL,
 site_version integer NOT NULL,
 kind text NOT NULL,
 audiences jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(site_id,site_version) REFERENCES operations_board_versions(site_id,version),
 UNIQUE(site_id,site_version,kind)
);
CREATE TRIGGER immutable_operations_board_event BEFORE UPDATE OR DELETE ON operations_board_events FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
