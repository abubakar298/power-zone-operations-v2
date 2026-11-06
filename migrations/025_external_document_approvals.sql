CREATE TABLE external_document_approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 quotation_id uuid UNIQUE REFERENCES quotation_versions(id),
 submission_id uuid UNIQUE REFERENCES ipo_submissions(id),
 channel text NOT NULL CHECK(channel IN ('WhatsApp','Verbal')),
 approver text NOT NULL,
 comments text NOT NULL,
 recorded_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((quotation_id IS NOT NULL)::int + (submission_id IS NOT NULL)::int = 1)
);
CREATE TABLE external_document_approval_files (
 approval_id uuid NOT NULL REFERENCES external_document_approvals(id),
 upload_id uuid NOT NULL REFERENCES survey_uploads(id),
 PRIMARY KEY(approval_id,upload_id)
);
CREATE TRIGGER immutable_external_approval BEFORE UPDATE OR DELETE ON external_document_approvals FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_external_approval_file BEFORE UPDATE OR DELETE ON external_document_approval_files FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
