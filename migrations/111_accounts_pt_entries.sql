CREATE TABLE accounts_pt_entries (
 id uuid PRIMARY KEY,
 source_kind text NOT NULL CHECK(source_kind IN ('IPO','Inventory')),
 source_id uuid NOT NULL,
 source_version integer NOT NULL CHECK(source_version > 0),
 pt_reference text NOT NULL CHECK(length(trim(pt_reference)) > 0),
 entry_date date NOT NULL,
 notes text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_kind,source_id,source_version)
);
CREATE TRIGGER immutable_accounts_pt_entry BEFORE UPDATE OR DELETE ON accounts_pt_entries FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
