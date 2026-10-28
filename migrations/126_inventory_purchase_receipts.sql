-- Purchase receiving shares the warehouse ledger with dispatch/return movements.
-- Old global receipts remain immutable and are never replayed by this migration.
CREATE TABLE inventory_material_purchase_receipts (
 id uuid PRIMARY KEY,
 number text NOT NULL UNIQUE,
 request_id uuid NOT NULL REFERENCES purchase_requests(id),
 warehouse text NOT NULL,
 source_sha256 text NOT NULL REFERENCES inventory_warehouse_sources(source_sha256),
 evidence_id uuid NOT NULL REFERENCES inventory_material_evidence(id),
 reason text NOT NULL CHECK(length(btrim(reason))>0),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 request_key uuid NOT NULL UNIQUE,
 request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 verified_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(request_id,evidence_id)
);
CREATE TABLE inventory_material_purchase_lines (
 id uuid PRIMARY KEY,
 receipt_id uuid NOT NULL REFERENCES inventory_material_purchase_receipts(id),
 item_key text NOT NULL,
 item_id text NOT NULL,
 unit text NOT NULL,
 quantity numeric(20,6) NOT NULL CHECK(quantity>0),
 source_sha256 text NOT NULL,
 ledger_key text NOT NULL,
 stock_entry_id uuid NOT NULL UNIQUE REFERENCES stock_on_hand_entries(id),
 UNIQUE(receipt_id,item_key), UNIQUE(receipt_id,id),
 FOREIGN KEY(source_sha256,ledger_key) REFERENCES inventory_warehouse_source_balances(source_sha256,ledger_key)
);
ALTER TABLE inventory_warehouse_operational_movements ALTER COLUMN draft_id DROP NOT NULL;
ALTER TABLE inventory_warehouse_operational_movements ALTER COLUMN dispatch_id DROP NOT NULL;
ALTER TABLE inventory_warehouse_operational_movements ALTER COLUMN line_key DROP NOT NULL;
ALTER TABLE inventory_warehouse_operational_movements ADD COLUMN purchase_receipt_id uuid REFERENCES inventory_material_purchase_receipts(id);
ALTER TABLE inventory_warehouse_operational_movements ADD COLUMN purchase_line_id uuid UNIQUE;
ALTER TABLE inventory_warehouse_operational_movements ADD FOREIGN KEY(purchase_receipt_id,purchase_line_id) REFERENCES inventory_material_purchase_lines(receipt_id,id);
-- Replace only checks involving the movement kind; retain closing arithmetic,
-- original foreign keys, immutable triggers and the shared revision constraint.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='inventory_warehouse_operational_movements'::regclass AND contype='c' AND (SELECT attnum FROM pg_attribute WHERE attrelid=conrelid AND attname='kind')=ANY(conkey)
 LOOP EXECUTE format('ALTER TABLE inventory_warehouse_operational_movements DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
ALTER TABLE inventory_warehouse_operational_movements ADD CONSTRAINT warehouse_movement_source CHECK(
 (kind='dispatch-out' AND draft_id IS NOT NULL AND dispatch_id IS NOT NULL AND line_key IS NOT NULL AND receipt_id IS NULL AND purchase_receipt_id IS NULL AND purchase_line_id IS NULL AND in_delta=0 AND out_delta>0)
 OR (kind='return-in' AND draft_id IS NOT NULL AND dispatch_id IS NOT NULL AND line_key IS NOT NULL AND receipt_id IS NOT NULL AND purchase_receipt_id IS NULL AND purchase_line_id IS NULL AND in_delta>0 AND out_delta=0)
 OR (kind='purchase-in' AND draft_id IS NULL AND dispatch_id IS NULL AND line_key IS NULL AND receipt_id IS NULL AND purchase_receipt_id IS NOT NULL AND purchase_line_id IS NOT NULL AND in_delta>0 AND out_delta=0)
);
CREATE TRIGGER immutable_material_purchase_receipt BEFORE UPDATE OR DELETE ON inventory_material_purchase_receipts FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_material_purchase_line BEFORE UPDATE OR DELETE ON inventory_material_purchase_lines FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
