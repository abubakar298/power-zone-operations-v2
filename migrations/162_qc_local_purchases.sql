-- QC records site purchases for Accounts; never warehouse custody or a stock movement.
CREATE TABLE operations_site_local_purchase_versions (
 site_id text NOT NULL REFERENCES operations_board_sites(id),
 version integer NOT NULL CHECK(version>0),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 request_key uuid NOT NULL UNIQUE,
 request_fingerprint text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(site_id,version)
);
CREATE TRIGGER immutable_operations_site_local_purchases BEFORE UPDATE OR DELETE ON operations_site_local_purchase_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
