-- Actual site usage verified against the linked historical DO and site evidence.
-- No warehouse movements, approved BOQs or PT entries are written here.
CREATE TABLE inventory_historical_qc_issue_usage (
  site_id text NOT NULL REFERENCES operations_board_sites(id),
  job_key text NOT NULL,
  version integer NOT NULL CHECK(version > 0),
  snapshot jsonb NOT NULL,
  request_key uuid UNIQUE NOT NULL,
  request_fingerprint text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(site_id,version)
);
CREATE TRIGGER immutable_inventory_historical_qc_issue_usage
  BEFORE UPDATE OR DELETE ON inventory_historical_qc_issue_usage
  FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
