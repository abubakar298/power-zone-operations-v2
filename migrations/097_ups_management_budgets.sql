-- Additive Management reporting baselines; never rewrite an issued IPO or its cost snapshot.
CREATE TABLE ups_management_program_versions (
 id uuid PRIMARY KEY,
 program_key text NOT NULL,
 version integer NOT NULL CHECK(version>0),
 customer_code text NOT NULL CHECK(customer_code IN('MBL','UBL')),
 snapshot jsonb NOT NULL,
 notes text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(program_key,version)
);
CREATE TABLE ups_management_budget_versions (
 id uuid PRIMARY KEY,
 ipo_id uuid NOT NULL REFERENCES internal_purchase_orders(id),
 version integer NOT NULL CHECK(version>0),
 snapshot jsonb NOT NULL,
 notes text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(ipo_id,version)
);
CREATE TRIGGER immutable_ups_management_program BEFORE UPDATE OR DELETE ON ups_management_program_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_ups_management_budget BEFORE UPDATE OR DELETE ON ups_management_budget_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
