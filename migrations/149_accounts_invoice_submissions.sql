-- Actual bank-submission metadata. Existing invoices, receipts and balances stay immutable.
CREATE TABLE accounts_invoice_submissions (
 id uuid PRIMARY KEY,
 source_kind text NOT NULL CHECK(source_kind IN('Operations','Source register')),
 site_key text NOT NULL CHECK(length(site_key) BETWEEN 1 AND 160),
 source_key text NOT NULL CHECK(length(source_key) BETWEEN 1 AND 160),
 source_version integer NOT NULL CHECK(source_version>0),
 milestone text NOT NULL CHECK(milestone IN('delivery','completion')),
 invoice_reference text NOT NULL CHECK(length(invoice_reference) BETWEEN 1 AND 1000),
 submitted_on date NOT NULL,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 request jsonb NOT NULL,
 request_key uuid NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_key,milestone)
);
CREATE TRIGGER immutable_accounts_invoice_submission BEFORE UPDATE OR DELETE ON accounts_invoice_submissions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
