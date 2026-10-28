-- Explicit historical register imports. These are source-linked IPO documents,
-- not invoices, payments, warehouse receipts or historical stock replays.
CREATE TABLE historical_pending_ipo_imports (
 id uuid PRIMARY KEY,
 board_site_id text NOT NULL UNIQUE REFERENCES operations_board_sites(id),
 board_version integer NOT NULL,
 accounts_source_id uuid NOT NULL REFERENCES accounts_source_registers(id),
 source_key text NOT NULL,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 source_row jsonb NOT NULL,
 framework_id uuid NOT NULL REFERENCES project_framework_versions(id),
 record_id uuid NOT NULL UNIQUE REFERENCES project_workflow_records(id),
 ipo_id uuid NOT NULL UNIQUE REFERENCES internal_purchase_orders(id),
 request_key uuid NOT NULL UNIQUE,
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 reason text NOT NULL CHECK(length(btrim(reason))>0),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(board_site_id,board_version) REFERENCES operations_board_versions(site_id,version),
 UNIQUE(accounts_source_id,source_key)
);
CREATE TRIGGER immutable_historical_pending_ipo_import BEFORE UPDATE OR DELETE ON historical_pending_ipo_imports FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
