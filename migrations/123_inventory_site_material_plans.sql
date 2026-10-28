-- A site's fixed and variable preparation is saved together. These records
-- never authorize dispatch, reserve stock or create a warehouse movement.
CREATE TABLE inventory_site_material_plans (
 id uuid PRIMARY KEY,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE inventory_site_material_plan_versions (
 plan_id uuid NOT NULL REFERENCES inventory_site_material_plans(id),
 version integer NOT NULL CHECK(version>0),
 fixed_draft_id uuid NOT NULL,
 fixed_draft_version integer NOT NULL,
 variable_draft_id uuid,
 variable_draft_version integer,
 variable_supply text NOT NULL CHECK(variable_supply IN ('single-site','parent-do')),
 request_key uuid NOT NULL UNIQUE,
 request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(plan_id,version),
 FOREIGN KEY(fixed_draft_id,fixed_draft_version) REFERENCES inventory_material_draft_versions(draft_id,version),
 FOREIGN KEY(variable_draft_id,variable_draft_version) REFERENCES inventory_material_draft_versions(draft_id,version),
 CHECK((variable_draft_id IS NULL)=(variable_draft_version IS NULL)),
 CHECK(variable_draft_id IS NOT NULL OR variable_supply='single-site'),
 CHECK(fixed_draft_id<>variable_draft_id)
);
CREATE TRIGGER immutable_inventory_site_material_plan BEFORE UPDATE OR DELETE ON inventory_site_material_plans FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_inventory_site_material_plan_version BEFORE UPDATE OR DELETE ON inventory_site_material_plan_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
