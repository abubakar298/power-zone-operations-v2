ALTER TABLE customers ADD COLUMN city text NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN province text NOT NULL DEFAULT '';
CREATE TABLE customer_import_batches (
 id uuid PRIMARY KEY, source text NOT NULL, source_hash text NOT NULL,
 before_customers jsonb NOT NULL, result jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_customer_import_batch BEFORE UPDATE OR DELETE ON customer_import_batches FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
