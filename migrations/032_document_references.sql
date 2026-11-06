-- Additive reference registry: no historical documents or master rows are rewritten.
CREATE TABLE document_sequences (
 document_type text NOT NULL, calendar_year integer NOT NULL,
 last_value integer NOT NULL CHECK(last_value>0),
 PRIMARY KEY(document_type,calendar_year)
);
CREATE TABLE document_site_identities (
 customer_id integer NOT NULL REFERENCES customers(id), site_code text NOT NULL,
 site_number integer NOT NULL CHECK(site_number>0),
 PRIMARY KEY(customer_id,site_code), UNIQUE(customer_id,site_number)
);
-- Stable per-customer ordinals for maintained sites; store separately from masters.
INSERT INTO document_site_identities(customer_id,site_code,site_number)
SELECT customer_id,code,row_number() OVER(PARTITION BY customer_id ORDER BY first_id)::integer
FROM (SELECT customer_id,lower(code) AS code,min(id) AS first_id FROM sites GROUP BY customer_id,lower(code)) s;
CREATE TABLE document_reference_roots (
 document_type text NOT NULL, family_id uuid NOT NULL,
 reference text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(document_type,family_id)
);
ALTER TABLE design_surveys ADD COLUMN number text;
CREATE TRIGGER immutable_document_reference_root BEFORE UPDATE OR DELETE ON document_reference_roots FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_document_site_identity BEFORE UPDATE OR DELETE ON document_site_identities FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
