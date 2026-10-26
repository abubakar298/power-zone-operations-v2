CREATE TABLE operations_delivery_plans (
 id uuid PRIMARY KEY,
 issuance_id uuid NOT NULL REFERENCES operations_boq_issuances(id),
 version integer NOT NULL CHECK(version>0),
 details jsonb NOT NULL,
 request_key uuid UNIQUE NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(issuance_id,version)
);
CREATE TRIGGER immutable_operations_delivery_plan BEFORE UPDATE OR DELETE ON operations_delivery_plans FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
