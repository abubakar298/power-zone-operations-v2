-- PT invoice references only: no financial, receivable or inventory postings.
CREATE TABLE accounts_invoice_entries (
 id uuid PRIMARY KEY,
 source_kind text NOT NULL CHECK(source_kind IN('Operations','Source register')),
 site_key text NOT NULL CHECK(length(site_key) BETWEEN 1 AND 160),
 source_version integer NOT NULL CHECK(source_version>0),
 milestone text NOT NULL CHECK(milestone IN('delivery','completion')),
 pt_reference text NOT NULL CHECK(length(pt_reference) BETWEEN 1 AND 200),
 entry_date date NOT NULL,
 notes text NOT NULL CHECK(length(notes)<=2000),
 snapshot jsonb NOT NULL,
 request jsonb NOT NULL,
 request_key uuid NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_kind,site_key,milestone)
);
CREATE TRIGGER immutable_accounts_invoice_entry BEFORE UPDATE OR DELETE ON accounts_invoice_entries FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
