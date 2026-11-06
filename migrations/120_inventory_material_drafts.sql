-- Server-owned preparation only. Saving a draft neither issues nor reserves stock.
CREATE TABLE inventory_material_access (
 user_id uuid NOT NULL REFERENCES users(id),
 warehouse text NOT NULL CHECK(length(btrim(warehouse))>0),
 capability text NOT NULL CHECK(capability IN ('dispatcher','storekeeper')),
 granted_by uuid NOT NULL REFERENCES users(id),
 granted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,warehouse,capability)
);
CREATE TABLE inventory_material_drafts (
 id uuid PRIMARY KEY,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE inventory_material_draft_versions (
 draft_id uuid NOT NULL REFERENCES inventory_material_drafts(id),
 version integer NOT NULL CHECK(version>0),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 request_key uuid NOT NULL,
 request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(draft_id,version), UNIQUE(request_key)
);
CREATE TRIGGER immutable_inventory_material_draft BEFORE UPDATE OR DELETE ON inventory_material_drafts FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_inventory_material_draft_version BEFORE UPDATE OR DELETE ON inventory_material_draft_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
