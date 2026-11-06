-- Site use/sign-off is evidence, never a second warehouse OUT or an automatic IN.
CREATE TABLE inventory_material_site_usage_versions (
 draft_id uuid NOT NULL REFERENCES inventory_material_drafts(id),
 site_id uuid NOT NULL REFERENCES internal_purchase_orders(id),
 version integer NOT NULL CHECK(version>0),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 reason text NOT NULL,
 request_key uuid NOT NULL UNIQUE,
 request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(draft_id,site_id,version)
);
CREATE TRIGGER immutable_inventory_material_site_usage BEFORE UPDATE OR DELETE ON inventory_material_site_usage_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
