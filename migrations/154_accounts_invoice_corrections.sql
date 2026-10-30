-- Append-only metadata corrections; original statements, submissions and payments remain immutable.
CREATE TABLE accounts_invoice_corrections(
 id uuid PRIMARY KEY,
 source_row_id text NOT NULL,
 source_version integer NOT NULL,
 version integer NOT NULL CHECK(version>0),
 invoice_reference text NOT NULL CHECK(length(btrim(invoice_reference)) BETWEEN 1 AND 200),
 submitted_on date,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 snapshot jsonb NOT NULL,
 request jsonb NOT NULL,
 request_key uuid NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_row_id,version)
);
CREATE TRIGGER accounts_invoice_corrections_immutable BEFORE UPDATE OR DELETE ON accounts_invoice_corrections FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
