CREATE TABLE ubl_survey_review_packages (
 id uuid PRIMARY KEY,request_key uuid UNIQUE NOT NULL,created_by uuid NOT NULL REFERENCES users(id),
 status text NOT NULL CHECK(status IN('Saved for combining','Submitted for Management')),
 snapshot jsonb NOT NULL,xlsx bytea,report_pdf bytea,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status='Saved for combining' OR (xlsx IS NOT NULL AND report_pdf IS NOT NULL))
);
CREATE TRIGGER immutable_ubl_survey_review_package BEFORE UPDATE OR DELETE ON ubl_survey_review_packages FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
