CREATE TABLE backup_devices (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  label text NOT NULL CHECK(length(label) BETWEEN 1 AND 100),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 year',
  revoked_at timestamptz,
  last_used_at timestamptz
);
