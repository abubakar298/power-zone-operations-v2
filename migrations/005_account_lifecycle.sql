ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE audit_log ADD COLUMN target_user_id uuid REFERENCES users(id);
CREATE TABLE account_tokens (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('invite', 'reset', 'verify')),
  email text NOT NULL CHECK (email = lower(email)),
  role text REFERENCES roles(name),
  user_id uuid REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  CHECK ((purpose = 'invite' AND role IS NOT NULL AND user_id IS NULL) OR
         (purpose IN ('reset', 'verify') AND user_id IS NOT NULL AND role IS NULL))
);
CREATE UNIQUE INDEX account_tokens_live_identity ON account_tokens (purpose, email)
  WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE TABLE email_outbox (
  id uuid PRIMARY KEY REFERENCES account_tokens(id),
  encrypted_message text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'accepted', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  provider_id text
);
CREATE INDEX email_outbox_pending ON email_outbox(next_attempt_at) WHERE status = 'queued';
