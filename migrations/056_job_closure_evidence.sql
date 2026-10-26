CREATE TABLE job_closure_evidence (
 id uuid PRIMARY KEY,
 job_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN('PT costing screenshot','Client acknowledgment','Site photographs')),
 filename text NOT NULL, media_type text NOT NULL,
 content bytea NOT NULL, sha256 text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_closure_evidence_job ON job_closure_evidence(job_key,kind,created_at);
CREATE TRIGGER immutable_job_closure_evidence BEFORE UPDATE OR DELETE ON job_closure_evidence FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
