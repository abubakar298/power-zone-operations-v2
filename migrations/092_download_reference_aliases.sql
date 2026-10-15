-- Display aliases only; no business document IDs or numbers are changed.
CREATE TABLE download_reference_aliases (
 document_key text PRIMARY KEY,
 reference text UNIQUE NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
