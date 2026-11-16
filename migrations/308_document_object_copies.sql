-- Cloudflare R2 rollout, step 1 (user request, 16 Nov 2026): a register of stored
-- files that have been copied to R2 and read back with a matching sha256.
-- Additive only: the original files stay in their tables, unchanged.
CREATE TABLE document_object_copies (
  source_table text NOT NULL,
  source_column text NOT NULL,
  source_id text NOT NULL,
  object_key text NOT NULL UNIQUE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  size bigint NOT NULL CHECK (size > 0),
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_table, source_column, source_id)
);
