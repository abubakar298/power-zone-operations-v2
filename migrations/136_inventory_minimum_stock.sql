-- Warehouse/item/UOM minimum closing settings. These are planning settings,
-- never stock movements. Retain every decision and its reviewed catalogue basis.
CREATE TABLE inventory_minimum_stock_versions (
 warehouse text NOT NULL,
 item_id text NOT NULL,
 unit text NOT NULL,
 version integer NOT NULL CHECK(version>0),
 minimum numeric(20,6) NOT NULL CHECK(minimum>=0),
 source_sha256 text NOT NULL REFERENCES inventory_warehouse_sources(source_sha256),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 2000),
 request_key uuid NOT NULL UNIQUE,
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(warehouse,item_id,unit,version)
);
CREATE TRIGGER immutable_inventory_minimum_stock BEFORE UPDATE OR DELETE ON inventory_minimum_stock_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
