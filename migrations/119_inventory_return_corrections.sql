-- Exactly-once approved corrections to the warehouse reconciliation projection.
-- Original historical events and the legacy Procurement count/receipt table stay intact.
ALTER TABLE inventory_review_versions DROP CONSTRAINT inventory_review_versions_state_check;
ALTER TABLE inventory_review_versions ADD CONSTRAINT inventory_review_versions_state_check
 CHECK(state IN ('source-verified','needs-review','proposed','clarification','approved-awaiting-posting','posted'));
CREATE TABLE inventory_warehouse_return_corrections (
 case_id text PRIMARY KEY,
 approval_version integer NOT NULL,
 source_sha256 text NOT NULL,
 ledger_key text NOT NULL,
 ledger_revision integer NOT NULL CHECK(ledger_revision>0),
 in_delta numeric(20,6) NOT NULL CHECK(in_delta<>0),
 closing_before numeric(30,12) NOT NULL,
 closing_after numeric(30,12) NOT NULL,
 approved_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(case_id,approval_version) REFERENCES inventory_review_versions(case_id,version),
 FOREIGN KEY(source_sha256,ledger_key) REFERENCES inventory_warehouse_source_balances(source_sha256,ledger_key),
 UNIQUE(source_sha256,ledger_key,ledger_revision),
 CHECK(closing_after=closing_before+in_delta)
);
CREATE TRIGGER immutable_inventory_warehouse_return_correction BEFORE UPDATE OR DELETE ON inventory_warehouse_return_corrections FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
