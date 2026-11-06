-- Historical evidence, not new stock receipts or an activation of live balances.
CREATE TABLE inventory_warehouse_sources (
 source_sha256 text PRIMARY KEY CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 catalogue_sha256 text NOT NULL CHECK(catalogue_sha256 ~ '^[a-f0-9]{64}$'),
 metadata jsonb NOT NULL,
 content_fingerprint text NOT NULL CHECK(content_fingerprint ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE inventory_warehouse_source_balances (
 source_sha256 text NOT NULL REFERENCES inventory_warehouse_sources(source_sha256),
 ledger_key text NOT NULL CHECK(ledger_key ~ '^[a-f0-9]{64}$'),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 PRIMARY KEY(source_sha256,ledger_key)
);
CREATE TABLE inventory_warehouse_source_events (
 source_sha256 text NOT NULL REFERENCES inventory_warehouse_sources(source_sha256),
 event_id text NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 PRIMARY KEY(source_sha256,event_id)
);
CREATE TABLE inventory_review_warehouse_sources (
 review_source_sha256 text PRIMARY KEY REFERENCES inventory_review_sources(source_sha256),
 warehouse_source_sha256 text NOT NULL REFERENCES inventory_warehouse_sources(source_sha256),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_inventory_warehouse_source BEFORE UPDATE OR DELETE ON inventory_warehouse_sources FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_inventory_warehouse_source_balance BEFORE UPDATE OR DELETE ON inventory_warehouse_source_balances FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_inventory_warehouse_source_event BEFORE UPDATE OR DELETE ON inventory_warehouse_source_events FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_inventory_review_warehouse_source BEFORE UPDATE OR DELETE ON inventory_review_warehouse_sources FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
