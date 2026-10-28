-- Imported source registers are analytical evidence, not postings to stock,
-- invoices, receipts or job costs. Versions and their source manifest are retained.
CREATE TABLE accounts_source_registers (
 id uuid PRIMARY KEY,
 version integer NOT NULL UNIQUE CHECK(version > 0),
 source_sha256 text NOT NULL UNIQUE CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 source_date date NOT NULL,
 snapshot jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_accounts_source_register BEFORE UPDATE OR DELETE ON accounts_source_registers FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
