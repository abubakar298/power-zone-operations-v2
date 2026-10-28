-- Additive operational ledger. Historical source events are never replayed.
CREATE TABLE inventory_warehouse_authority_versions (
 warehouse text NOT NULL CHECK(length(btrim(warehouse))>0),
 version integer NOT NULL CHECK(version>0),
 source_sha256 text NOT NULL REFERENCES inventory_warehouse_sources(source_sha256),
 state text NOT NULL CHECK(state IN ('active','suspended')),
 reason text NOT NULL CHECK(length(btrim(reason))>0),
 request_key uuid NOT NULL UNIQUE,
 request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(warehouse,version)
);
CREATE VIEW inventory_warehouse_authority_current AS
 SELECT DISTINCT ON(warehouse) * FROM inventory_warehouse_authority_versions ORDER BY warehouse,version DESC;

CREATE TABLE inventory_material_evidence (
 id uuid PRIMARY KEY,
 warehouse text NOT NULL CHECK(length(btrim(warehouse))>0),
 original_name text NOT NULL CHECK(length(original_name) BETWEEN 1 AND 255),
 media_type text NOT NULL CHECK(media_type IN ('application/pdf','image/png','image/jpeg')),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 15728640),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(warehouse,sha256)
);
CREATE TABLE inventory_material_dispatches (
 id uuid PRIMARY KEY,
 number text NOT NULL UNIQUE,
 draft_id uuid NOT NULL,
 draft_version integer NOT NULL,
 source_sha256 text NOT NULL REFERENCES inventory_warehouse_sources(source_sha256),
 warehouse text NOT NULL,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 request_key uuid NOT NULL UNIQUE,
 request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(draft_id,draft_version) REFERENCES inventory_material_draft_versions(draft_id,version),
 UNIQUE(id,draft_id)
);
CREATE TABLE inventory_material_dispatch_lines (
 dispatch_id uuid NOT NULL REFERENCES inventory_material_dispatches(id),
 line_key uuid NOT NULL,
 source_sha256 text NOT NULL,
 ledger_key text NOT NULL,
 item_id text NOT NULL,
 unit text NOT NULL,
 description text NOT NULL,
 quantity numeric(20,6) NOT NULL CHECK(quantity>0),
 PRIMARY KEY(dispatch_id,line_key),
 FOREIGN KEY(source_sha256,ledger_key) REFERENCES inventory_warehouse_source_balances(source_sha256,ledger_key)
);
CREATE TABLE inventory_material_receipts (
 id uuid PRIMARY KEY,
 number text NOT NULL UNIQUE,
 draft_id uuid NOT NULL REFERENCES inventory_material_drafts(id),
 evidence_id uuid NOT NULL REFERENCES inventory_material_evidence(id),
 reason text NOT NULL CHECK(length(btrim(reason))>0),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 request_key uuid NOT NULL UNIQUE,
 request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 verified_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,draft_id), UNIQUE(draft_id,evidence_id)
);
CREATE TABLE inventory_material_receipt_lines (
 receipt_id uuid NOT NULL,
 draft_id uuid NOT NULL,
 dispatch_id uuid NOT NULL,
 line_key uuid NOT NULL,
 quantity numeric(20,6) NOT NULL CHECK(quantity>0),
 PRIMARY KEY(receipt_id,dispatch_id,line_key),
 FOREIGN KEY(receipt_id,draft_id) REFERENCES inventory_material_receipts(id,draft_id),
 FOREIGN KEY(dispatch_id,draft_id) REFERENCES inventory_material_dispatches(id,draft_id),
 FOREIGN KEY(dispatch_id,line_key) REFERENCES inventory_material_dispatch_lines(dispatch_id,line_key)
);
CREATE TABLE inventory_warehouse_operational_movements (
 id uuid PRIMARY KEY,
 source_sha256 text NOT NULL,
 ledger_key text NOT NULL,
 ledger_revision integer NOT NULL CHECK(ledger_revision>0),
 kind text NOT NULL CHECK(kind IN ('dispatch-out','return-in')),
 draft_id uuid NOT NULL,
 dispatch_id uuid NOT NULL,
 receipt_id uuid,
 line_key uuid NOT NULL,
 in_delta numeric(20,6) NOT NULL CHECK(in_delta>=0),
 out_delta numeric(20,6) NOT NULL CHECK(out_delta>=0),
 closing_before numeric(30,12) NOT NULL,
 closing_after numeric(30,12) NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(source_sha256,ledger_key) REFERENCES inventory_warehouse_source_balances(source_sha256,ledger_key),
 FOREIGN KEY(dispatch_id,line_key) REFERENCES inventory_material_dispatch_lines(dispatch_id,line_key),
 FOREIGN KEY(dispatch_id,draft_id) REFERENCES inventory_material_dispatches(id,draft_id),
 FOREIGN KEY(receipt_id,draft_id) REFERENCES inventory_material_receipts(id,draft_id),
 UNIQUE(source_sha256,ledger_key,ledger_revision),
 CHECK(closing_after=closing_before+in_delta-out_delta),
 CHECK((kind='dispatch-out' AND receipt_id IS NULL AND in_delta=0 AND out_delta>0)
    OR (kind='return-in' AND receipt_id IS NOT NULL AND in_delta>0 AND out_delta=0))
);
CREATE UNIQUE INDEX inventory_material_out_once ON inventory_warehouse_operational_movements(dispatch_id,line_key) WHERE kind='dispatch-out';
CREATE UNIQUE INDEX inventory_material_in_once ON inventory_warehouse_operational_movements(receipt_id,dispatch_id,line_key) WHERE kind='return-in';
CREATE INDEX inventory_material_movements_position ON inventory_warehouse_operational_movements(source_sha256,ledger_key);

CREATE TRIGGER immutable_inventory_warehouse_authority BEFORE UPDATE OR DELETE ON inventory_warehouse_authority_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_inventory_material_evidence BEFORE UPDATE OR DELETE ON inventory_material_evidence FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_inventory_material_dispatch BEFORE UPDATE OR DELETE ON inventory_material_dispatches FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_inventory_material_dispatch_line BEFORE UPDATE OR DELETE ON inventory_material_dispatch_lines FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_inventory_material_receipt BEFORE UPDATE OR DELETE ON inventory_material_receipts FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_inventory_material_receipt_line BEFORE UPDATE OR DELETE ON inventory_material_receipt_lines FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_inventory_warehouse_movement BEFORE UPDATE OR DELETE ON inventory_warehouse_operational_movements FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
