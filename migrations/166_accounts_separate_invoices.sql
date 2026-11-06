-- Separate PT invoices: one site milestone may carry several invoices, each with its
-- own number, amount, type and submission. Existing rows are not changed; they keep
-- NULL for the new columns and remain flagged where no amount was recorded.
ALTER TABLE accounts_invoice_entries ADD COLUMN invoice_stage text CHECK(invoice_stage IN('advance-delivery','balance-completion','delivery-only','extra-cable','internet'));
ALTER TABLE accounts_invoice_entries ADD COLUMN invoice_label text CHECK(length(btrim(invoice_label)) BETWEEN 1 AND 200);
ALTER TABLE accounts_invoice_entries ADD COLUMN amount numeric(20,2) CHECK(amount>0);
-- Normalised invoice number; only new separate invoices carry it, so historical
-- combined references cannot block the index.
ALTER TABLE accounts_invoice_entries ADD COLUMN invoice_identity text CHECK(length(invoice_identity) BETWEEN 1 AND 200);
CREATE UNIQUE INDEX accounts_invoice_entry_identity ON accounts_invoice_entries(invoice_identity) WHERE invoice_identity IS NOT NULL;
ALTER TABLE accounts_invoice_entries DROP CONSTRAINT accounts_invoice_entries_source_kind_site_key_milestone_key;

-- Submission belongs to one invoice. Legacy milestone-level submissions keep their
-- one-per-milestone protection.
ALTER TABLE accounts_invoice_submissions ADD COLUMN invoice_entry_id uuid REFERENCES accounts_invoice_entries(id);
CREATE UNIQUE INDEX accounts_invoice_submission_entry ON accounts_invoice_submissions(invoice_entry_id) WHERE invoice_entry_id IS NOT NULL;
CREATE UNIQUE INDEX accounts_invoice_submission_legacy_milestone ON accounts_invoice_submissions(source_key,milestone) WHERE invoice_entry_id IS NULL;
ALTER TABLE accounts_invoice_submissions DROP CONSTRAINT accounts_invoice_submissions_source_key_milestone_key;

-- Append-only invoice updates: amount entry/correction (no payment) and the reason a
-- created invoice is not yet submitted. The latest version is the current state.
CREATE TABLE accounts_invoice_updates(
 id uuid PRIMARY KEY,
 invoice_key text NOT NULL CHECK(length(invoice_key) BETWEEN 1 AND 500),
 version integer NOT NULL CHECK(version>0),
 amount numeric(20,2) CHECK(amount>0),
 delay_reason text CHECK(delay_reason IN('qc-pictures','physical-originals','customer-clarification','other')),
 delay_note text NOT NULL DEFAULT '' CHECK(length(delay_note)<=2000),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 request jsonb NOT NULL,
 request_key uuid NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(invoice_key,version),
 CHECK(delay_reason IS DISTINCT FROM 'other' OR length(btrim(delay_note))>0)
);
CREATE TRIGGER accounts_invoice_updates_immutable BEFORE UPDATE OR DELETE ON accounts_invoice_updates FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

-- Accounts confirms that material costs were entered in Peachtree for a job,
-- whether or not Inventory has sent its reconciliation yet.
CREATE TABLE accounts_job_pt_entries(
 id uuid PRIMARY KEY,
 job_key text NOT NULL UNIQUE CHECK(length(job_key) BETWEEN 1 AND 200),
 site_id text CHECK(length(site_id) BETWEEN 1 AND 160),
 report_version_id uuid REFERENCES inventory_report_versions(id),
 pt_reference text NOT NULL CHECK(length(btrim(pt_reference)) BETWEEN 1 AND 200),
 entry_date date NOT NULL,
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 request jsonb NOT NULL,
 request_key uuid NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER accounts_job_pt_entries_immutable BEFORE UPDATE OR DELETE ON accounts_job_pt_entries FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

-- Accounts custody of physical originals. QC's "Received at Karachi office" reports
-- arrival only; each original is confirmed separately with its actual receipt date.
CREATE TABLE accounts_original_receipts(
 id uuid PRIMARY KEY,
 site_id text NOT NULL CHECK(length(site_id) BETWEEN 1 AND 160),
 item_key text NOT NULL CHECK(length(item_key) BETWEEN 1 AND 400),
 document_id text NOT NULL CHECK(length(document_id) BETWEEN 1 AND 200),
 document_type text NOT NULL CHECK(document_type IN('Signed DO','VSO','Customer acknowledgment')),
 received_on date NOT NULL,
 site_version integer NOT NULL CHECK(site_version>0),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 request jsonb NOT NULL,
 request_key uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(site_id,item_key),
 UNIQUE(request_key,item_key)
);
CREATE TRIGGER accounts_original_receipts_immutable BEFORE UPDATE OR DELETE ON accounts_original_receipts FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
