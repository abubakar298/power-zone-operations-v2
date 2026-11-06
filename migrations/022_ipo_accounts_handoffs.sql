CREATE TABLE ipo_accounts_handoffs (
 id uuid PRIMARY KEY,
 ipo_id uuid UNIQUE NOT NULL REFERENCES internal_purchase_orders(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_ipo_accounts_handoff BEFORE UPDATE OR DELETE ON ipo_accounts_handoffs FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
