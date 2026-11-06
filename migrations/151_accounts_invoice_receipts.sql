-- Actual operational receipts; imported statements and historical receipt metadata stay intact.
CREATE TABLE accounts_invoice_receipts (
 id uuid PRIMARY KEY,
 ledger_key text NOT NULL,
 source_row_id text NOT NULL,
 submission_id uuid REFERENCES accounts_invoice_submissions(id),
 source_version integer NOT NULL,
 invoice_reference text NOT NULL,
 customer text NOT NULL,
 amount numeric(20,2) NOT NULL CHECK(amount>0),
 baseline_pending numeric(20,2) NOT NULL CHECK(baseline_pending>0),
 payment_date date NOT NULL,
 transaction_id text NOT NULL CHECK(length(btrim(transaction_id)) BETWEEN 1 AND 200),
 snapshot jsonb NOT NULL,
 request jsonb NOT NULL,
 request_key uuid NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX accounts_invoice_receipt_transaction ON accounts_invoice_receipts(ledger_key,lower(btrim(transaction_id)));
CREATE TRIGGER accounts_invoice_receipts_immutable BEFORE UPDATE OR DELETE ON accounts_invoice_receipts FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
