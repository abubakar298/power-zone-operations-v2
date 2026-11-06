CREATE TABLE accounts_ipo_reviews (
 id uuid PRIMARY KEY, ipo_id uuid NOT NULL REFERENCES internal_purchase_orders(id),
 version integer NOT NULL CHECK(version>0), decision text NOT NULL CHECK(decision IN('Verified','Returned for Revision')),
 notes text NOT NULL, snapshot jsonb NOT NULL, request_key uuid NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(ipo_id,version)
);
CREATE TRIGGER immutable_accounts_ipo_review BEFORE UPDATE OR DELETE ON accounts_ipo_reviews FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TABLE accounts_job_closures (
 id uuid PRIMARY KEY, job_key text NOT NULL, report_version_id uuid NOT NULL REFERENCES inventory_report_versions(id),
 version integer NOT NULL CHECK(version>0), stage text NOT NULL CHECK(stage IN('Draft','Awaiting Management','Returned for Revision','Closed')),
 snapshot jsonb NOT NULL, request_key uuid NOT NULL UNIQUE, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(job_key,version)
);
CREATE TRIGGER immutable_accounts_job_closure BEFORE UPDATE OR DELETE ON accounts_job_closures FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
