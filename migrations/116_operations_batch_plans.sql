CREATE TABLE operations_board_batch_versions (
 batch_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 number text NOT NULL,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 request_key uuid NOT NULL UNIQUE,
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 reason text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(batch_id,version), UNIQUE(number,version)
);
CREATE TRIGGER immutable_operations_board_batch BEFORE UPDATE OR DELETE ON operations_board_batch_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
