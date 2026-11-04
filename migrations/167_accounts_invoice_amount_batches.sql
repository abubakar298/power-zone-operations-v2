-- Owner-confirmed bulk entry of missing original invoice amounts. Each batch keeps the
-- reviewed before-state; the amounts themselves are ordinary invoice corrections.
CREATE TABLE accounts_invoice_amount_batches (
 id uuid PRIMARY KEY,
 reference text NOT NULL UNIQUE,
 fingerprint text NOT NULL UNIQUE,
 source_version integer NOT NULL,
 basis text NOT NULL,
 before_state jsonb NOT NULL,
 applied jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER accounts_invoice_amount_batches_immutable BEFORE UPDATE OR DELETE ON accounts_invoice_amount_batches FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
