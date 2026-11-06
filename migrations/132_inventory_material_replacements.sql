-- STAGED ONLY: original DO warranty/replacement OUT and separately counted faulty holdings.
-- A faulty physical return is NOT usable warehouse IN. No historical rows are replayed.
CREATE TABLE inventory_material_replacement_cases (
 id uuid PRIMARY KEY,
 original_dispatch_id uuid NOT NULL,
 original_line_key uuid NOT NULL,
 original_warehouse text NOT NULL,
 warehouse text NOT NULL,
 item_id text NOT NULL,
 unit text NOT NULL,
 original_quantity numeric(20,6) NOT NULL CHECK(original_quantity>0),
 replacement_quantity numeric(20,6) NOT NULL CHECK(replacement_quantity>0 AND replacement_quantity<=original_quantity),
 expected_return_quantity numeric(20,6) CHECK(expected_return_quantity>=0 AND expected_return_quantity<=original_quantity),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 request_key uuid NOT NULL UNIQUE,
 request_fingerprint text NOT NULL CHECK(request_fingerprint~'^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(original_dispatch_id,original_line_key) REFERENCES inventory_material_dispatch_lines(dispatch_id,line_key),
 UNIQUE(id,original_dispatch_id,original_line_key)
);
CREATE TABLE inventory_material_replacement_case_versions (
 case_id uuid NOT NULL REFERENCES inventory_material_replacement_cases(id),
 version integer NOT NULL CHECK(version>0),
 action text NOT NULL CHECK(action IN('opened','replacement-out','faulty-return-held','usable-release')),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 2000),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(case_id,version)
);
CREATE TABLE inventory_material_replacement_dispatches (
 id uuid PRIMARY KEY,
 number text NOT NULL UNIQUE,
 case_id uuid NOT NULL,
 case_version integer NOT NULL,
 original_dispatch_id uuid NOT NULL,
 original_line_key uuid NOT NULL,
 warehouse text NOT NULL,
 source_sha256 text NOT NULL,
 ledger_key text NOT NULL,
 quantity numeric(20,6) NOT NULL CHECK(quantity>0),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 request_key uuid NOT NULL UNIQUE,
 request_fingerprint text NOT NULL CHECK(request_fingerprint~'^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(case_id,case_version) REFERENCES inventory_material_replacement_case_versions(case_id,version),
 FOREIGN KEY(case_id,original_dispatch_id,original_line_key) REFERENCES inventory_material_replacement_cases(id,original_dispatch_id,original_line_key),
 FOREIGN KEY(source_sha256,ledger_key) REFERENCES inventory_warehouse_source_balances(source_sha256,ledger_key),
 UNIQUE(id,original_dispatch_id,original_line_key),
 UNIQUE(id,source_sha256,ledger_key,quantity)
);
CREATE TABLE inventory_material_replacement_returns (
 id uuid PRIMARY KEY,
 number text NOT NULL UNIQUE,
 case_id uuid NOT NULL,
 case_version integer NOT NULL,
 warehouse text NOT NULL,
 quantity numeric(20,6) NOT NULL CHECK(quantity>0),
 evidence_id uuid NOT NULL REFERENCES inventory_material_evidence(id),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 request_key uuid NOT NULL UNIQUE,
 request_fingerprint text NOT NULL CHECK(request_fingerprint~'^[a-f0-9]{64}$'),
 counted_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(case_id,case_version) REFERENCES inventory_material_replacement_case_versions(case_id,version),
 UNIQUE(case_id,evidence_id),
 UNIQUE(id,case_id)
);
CREATE TABLE inventory_material_replacement_usable_releases (
 id uuid PRIMARY KEY,
 return_id uuid NOT NULL,
 case_id uuid NOT NULL,
 case_version integer NOT NULL,
 original_dispatch_id uuid NOT NULL,
 original_line_key uuid NOT NULL,
 warehouse text NOT NULL,
 source_sha256 text NOT NULL,
 ledger_key text NOT NULL,
 quantity numeric(20,6) NOT NULL CHECK(quantity>0),
 evidence_id uuid NOT NULL REFERENCES inventory_material_evidence(id),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 request_key uuid NOT NULL UNIQUE,
 request_fingerprint text NOT NULL CHECK(request_fingerprint~'^[a-f0-9]{64}$'),
 inspected_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(case_id,case_version) REFERENCES inventory_material_replacement_case_versions(case_id,version),
 FOREIGN KEY(return_id,case_id) REFERENCES inventory_material_replacement_returns(id,case_id),
 FOREIGN KEY(case_id,original_dispatch_id,original_line_key) REFERENCES inventory_material_replacement_cases(id,original_dispatch_id,original_line_key),
 FOREIGN KEY(source_sha256,ledger_key) REFERENCES inventory_warehouse_source_balances(source_sha256,ledger_key),
 UNIQUE(id,original_dispatch_id,original_line_key),
 UNIQUE(id,source_sha256,ledger_key,quantity)
);
ALTER TABLE inventory_warehouse_operational_movements ADD COLUMN replacement_dispatch_id uuid;
ALTER TABLE inventory_warehouse_operational_movements ADD COLUMN replacement_release_id uuid;
ALTER TABLE inventory_warehouse_operational_movements ADD FOREIGN KEY(replacement_dispatch_id,dispatch_id,line_key) REFERENCES inventory_material_replacement_dispatches(id,original_dispatch_id,original_line_key);
ALTER TABLE inventory_warehouse_operational_movements ADD FOREIGN KEY(replacement_release_id,dispatch_id,line_key) REFERENCES inventory_material_replacement_usable_releases(id,original_dispatch_id,original_line_key);
ALTER TABLE inventory_warehouse_operational_movements ADD FOREIGN KEY(replacement_dispatch_id,source_sha256,ledger_key,out_delta) REFERENCES inventory_material_replacement_dispatches(id,source_sha256,ledger_key,quantity);
ALTER TABLE inventory_warehouse_operational_movements ADD FOREIGN KEY(replacement_release_id,source_sha256,ledger_key,in_delta) REFERENCES inventory_material_replacement_usable_releases(id,source_sha256,ledger_key,quantity);
-- Extend, rather than reconstruct,131's source check. Closing arithmetic,
-- nonnegative deltas, source FKs, shared revision uniqueness and immutable triggers stay intact.
DO $$ DECLARE existing text; BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO existing FROM pg_constraint
  WHERE conrelid='inventory_warehouse_operational_movements'::regclass AND conname='warehouse_movement_source';
 IF existing IS NULL THEN RAISE EXCEPTION 'The prior warehouse movement source constraint is required'; END IF;
 ALTER TABLE inventory_warehouse_operational_movements DROP CONSTRAINT warehouse_movement_source;
 EXECUTE 'ALTER TABLE inventory_warehouse_operational_movements ADD CONSTRAINT warehouse_movement_source CHECK('
  ||'(replacement_dispatch_id IS NULL AND replacement_release_id IS NULL AND ('||existing||')) OR '
  ||'(kind=''replacement-out'' AND replacement_dispatch_id IS NOT NULL AND replacement_release_id IS NULL AND draft_id IS NOT NULL AND dispatch_id IS NOT NULL AND line_key IS NOT NULL AND receipt_id IS NULL AND purchase_receipt_id IS NULL AND purchase_line_id IS NULL AND transfer_id IS NULL AND transfer_line_key IS NULL AND transfer_receipt_id IS NULL AND in_delta=0 AND out_delta>0) OR '
  ||'(kind=''replacement-usable-in'' AND replacement_dispatch_id IS NULL AND replacement_release_id IS NOT NULL AND draft_id IS NOT NULL AND dispatch_id IS NOT NULL AND line_key IS NOT NULL AND receipt_id IS NULL AND purchase_receipt_id IS NULL AND purchase_line_id IS NULL AND transfer_id IS NULL AND transfer_line_key IS NULL AND transfer_receipt_id IS NULL AND in_delta>0 AND out_delta=0))';
END $$;
CREATE UNIQUE INDEX inventory_replacement_out_once ON inventory_warehouse_operational_movements(replacement_dispatch_id) WHERE kind='replacement-out';
CREATE UNIQUE INDEX inventory_replacement_usable_once ON inventory_warehouse_operational_movements(replacement_release_id) WHERE kind='replacement-usable-in';
CREATE INDEX inventory_replacement_cases_original ON inventory_material_replacement_cases(original_dispatch_id,original_line_key);
CREATE TRIGGER immutable_inventory_replacement_case BEFORE UPDATE OR DELETE ON inventory_material_replacement_cases FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_inventory_replacement_case_version BEFORE UPDATE OR DELETE ON inventory_material_replacement_case_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_inventory_replacement_dispatch BEFORE UPDATE OR DELETE ON inventory_material_replacement_dispatches FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_inventory_replacement_return BEFORE UPDATE OR DELETE ON inventory_material_replacement_returns FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_inventory_replacement_usable BEFORE UPDATE OR DELETE ON inventory_material_replacement_usable_releases FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
