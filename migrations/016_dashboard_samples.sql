-- Explicitly requested training records; never seeded automatically on deployment.
CREATE TABLE dashboard_sample_batches (
 key text PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 records jsonb NOT NULL
);
