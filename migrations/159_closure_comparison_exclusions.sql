-- Comparison eligibility only. Submitted/approved costs and closure history stay immutable.
CREATE TABLE closure_comparison_exclusions (
 job_key text PRIMARY KEY,
 excluded boolean NOT NULL DEFAULT true,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 2000),
 updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
