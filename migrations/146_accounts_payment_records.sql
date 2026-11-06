CREATE TABLE accounts_payment_records (
 id uuid PRIMARY KEY,
 source_row_id text NOT NULL UNIQUE,
 source_version integer NOT NULL,
 transaction_id text NOT NULL CHECK(length(trim(transaction_id)) BETWEEN 1 AND 200),
 payment_date date NOT NULL,
 snapshot jsonb NOT NULL,
 request jsonb NOT NULL,
 request_key uuid NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER accounts_payment_records_immutable BEFORE UPDATE OR DELETE ON accounts_payment_records
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
