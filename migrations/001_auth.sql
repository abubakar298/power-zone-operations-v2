CREATE TABLE roles (
  name text PRIMARY KEY CHECK (name IN ('Admin', 'Management', 'Employee'))
);
INSERT INTO roles (name) VALUES ('Admin'), ('Management'), ('Employee');

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL REFERENCES roles(name),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- This row is locked during setup. The completed flag cannot be reopened by deleting a user.
CREATE TABLE admin_bootstrap (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  completed_at timestamptz
);
INSERT INTO admin_bootstrap (singleton) VALUES (true);

CREATE TABLE auth_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);

CREATE TABLE auth_rate_limits (
  bucket_hash text PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts > 0),
  reset_at timestamptz NOT NULL
);
CREATE INDEX auth_rate_limits_reset_idx ON auth_rate_limits(reset_at);

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
