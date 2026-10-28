-- Physical warehouse transfers: OUT now, separately counted destination IN later.
-- No historical stock, costing or payments are replayed.
CREATE TABLE inventory_warehouse_transfers (
 id uuid PRIMARY KEY, number text NOT NULL UNIQUE,
 source_warehouse text NOT NULL, destination_warehouse text NOT NULL,
 source_sha256 text NOT NULL REFERENCES inventory_warehouse_sources(source_sha256),
 destination_source_sha256 text NOT NULL REFERENCES inventory_warehouse_sources(source_sha256),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 request_key uuid NOT NULL UNIQUE, request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(source_warehouse<>destination_warehouse)
);
CREATE TABLE inventory_warehouse_transfer_lines (
 transfer_id uuid NOT NULL REFERENCES inventory_warehouse_transfers(id), line_key uuid NOT NULL,
 item_id text NOT NULL, unit text NOT NULL, destination_unit text NOT NULL, description text NOT NULL,
 quantity numeric(20,6) NOT NULL CHECK(quantity>0),
 source_sha256 text NOT NULL, source_ledger_key text NOT NULL,
 destination_source_sha256 text NOT NULL, destination_ledger_key text NOT NULL,
 PRIMARY KEY(transfer_id,line_key), UNIQUE(transfer_id,source_ledger_key), UNIQUE(transfer_id,destination_ledger_key),
 FOREIGN KEY(source_sha256,source_ledger_key) REFERENCES inventory_warehouse_source_balances(source_sha256,ledger_key),
 FOREIGN KEY(destination_source_sha256,destination_ledger_key) REFERENCES inventory_warehouse_source_balances(source_sha256,ledger_key)
);
CREATE TABLE inventory_warehouse_transfer_receipts (
 id uuid PRIMARY KEY, number text NOT NULL UNIQUE,
 transfer_id uuid NOT NULL REFERENCES inventory_warehouse_transfers(id),
 evidence_id uuid NOT NULL UNIQUE REFERENCES inventory_material_evidence(id),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 reason text NOT NULL CHECK(length(btrim(reason))>0), request_key uuid NOT NULL UNIQUE,
 request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 verified_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,transfer_id)
);
CREATE TABLE inventory_warehouse_transfer_receipt_lines (
 receipt_id uuid NOT NULL, transfer_id uuid NOT NULL, line_key uuid NOT NULL,
 quantity numeric(20,6) NOT NULL CHECK(quantity>0), PRIMARY KEY(receipt_id,line_key),
 FOREIGN KEY(receipt_id,transfer_id) REFERENCES inventory_warehouse_transfer_receipts(id,transfer_id),
 FOREIGN KEY(transfer_id,line_key) REFERENCES inventory_warehouse_transfer_lines(transfer_id,line_key)
);
ALTER TABLE inventory_warehouse_operational_movements ADD COLUMN transfer_id uuid;
ALTER TABLE inventory_warehouse_operational_movements ADD COLUMN transfer_line_key uuid;
ALTER TABLE inventory_warehouse_operational_movements ADD COLUMN transfer_receipt_id uuid;
ALTER TABLE inventory_warehouse_operational_movements ADD FOREIGN KEY(transfer_id,transfer_line_key) REFERENCES inventory_warehouse_transfer_lines(transfer_id,line_key);
ALTER TABLE inventory_warehouse_operational_movements ADD FOREIGN KEY(transfer_receipt_id,transfer_id) REFERENCES inventory_warehouse_transfer_receipts(id,transfer_id);
ALTER TABLE inventory_warehouse_operational_movements DROP CONSTRAINT warehouse_movement_source;
ALTER TABLE inventory_warehouse_operational_movements ADD CONSTRAINT warehouse_movement_source CHECK(
 (kind='dispatch-out' AND draft_id IS NOT NULL AND dispatch_id IS NOT NULL AND line_key IS NOT NULL AND receipt_id IS NULL AND purchase_receipt_id IS NULL AND purchase_line_id IS NULL AND transfer_id IS NULL AND transfer_line_key IS NULL AND transfer_receipt_id IS NULL AND in_delta=0 AND out_delta>0)
 OR (kind='return-in' AND draft_id IS NOT NULL AND dispatch_id IS NOT NULL AND line_key IS NOT NULL AND receipt_id IS NOT NULL AND purchase_receipt_id IS NULL AND purchase_line_id IS NULL AND transfer_id IS NULL AND transfer_line_key IS NULL AND transfer_receipt_id IS NULL AND in_delta>0 AND out_delta=0)
 OR (kind='purchase-in' AND draft_id IS NULL AND dispatch_id IS NULL AND line_key IS NULL AND receipt_id IS NULL AND purchase_receipt_id IS NOT NULL AND purchase_line_id IS NOT NULL AND transfer_id IS NULL AND transfer_line_key IS NULL AND transfer_receipt_id IS NULL AND in_delta>0 AND out_delta=0)
 OR (kind='transfer-out' AND draft_id IS NULL AND dispatch_id IS NULL AND line_key IS NULL AND receipt_id IS NULL AND purchase_receipt_id IS NULL AND purchase_line_id IS NULL AND transfer_id IS NOT NULL AND transfer_line_key IS NOT NULL AND transfer_receipt_id IS NULL AND in_delta=0 AND out_delta>0)
 OR (kind='transfer-in' AND draft_id IS NULL AND dispatch_id IS NULL AND line_key IS NULL AND receipt_id IS NULL AND purchase_receipt_id IS NULL AND purchase_line_id IS NULL AND transfer_id IS NOT NULL AND transfer_line_key IS NOT NULL AND transfer_receipt_id IS NOT NULL AND in_delta>0 AND out_delta=0)
);
CREATE UNIQUE INDEX warehouse_transfer_out_once ON inventory_warehouse_operational_movements(transfer_id,transfer_line_key) WHERE kind='transfer-out';
CREATE UNIQUE INDEX warehouse_transfer_in_once ON inventory_warehouse_operational_movements(transfer_receipt_id,transfer_line_key) WHERE kind='transfer-in';
CREATE INDEX warehouse_transfer_parties ON inventory_warehouse_transfers(source_warehouse,destination_warehouse,created_at);
CREATE TRIGGER immutable_warehouse_transfer BEFORE UPDATE OR DELETE ON inventory_warehouse_transfers FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_warehouse_transfer_line BEFORE UPDATE OR DELETE ON inventory_warehouse_transfer_lines FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_warehouse_transfer_receipt BEFORE UPDATE OR DELETE ON inventory_warehouse_transfer_receipts FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_warehouse_transfer_receipt_line BEFORE UPDATE OR DELETE ON inventory_warehouse_transfer_receipt_lines FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
