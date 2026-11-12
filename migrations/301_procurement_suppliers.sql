CREATE TABLE procurement_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX procurement_suppliers_name_unique ON procurement_suppliers (lower(btrim(name)));
CREATE UNIQUE INDEX procurement_suppliers_email_unique ON procurement_suppliers (lower(btrim(email))) WHERE btrim(email)<>'';
