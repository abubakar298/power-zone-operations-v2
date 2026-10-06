CREATE TABLE operations_boq_issuances (
 id uuid PRIMARY KEY,
 ipo_id uuid UNIQUE NOT NULL REFERENCES internal_purchase_orders(id),
 boq_revision_id uuid NOT NULL REFERENCES boq_revisions(id),
 number text UNIQUE NOT NULL,
 snapshot jsonb NOT NULL,
 request_key uuid UNIQUE NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_operations_boq_issuance BEFORE UPDATE OR DELETE ON operations_boq_issuances FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
