CREATE TABLE costing_approval_instructions(
 submission_id uuid PRIMARY KEY REFERENCES boq_review_submissions(id),
 revision_id uuid UNIQUE NOT NULL REFERENCES boq_revisions(id),
 channel text NOT NULL CHECK(channel IN ('In app','External chat')),
 claimed_approver text NOT NULL,
 instructions jsonb NOT NULL,
 recorded_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE costing_approval_evidence(
 submission_id uuid NOT NULL REFERENCES costing_approval_instructions(submission_id),
 upload_id uuid NOT NULL REFERENCES survey_uploads(id),
 PRIMARY KEY(submission_id,upload_id)
);
CREATE TRIGGER immutable_costing_instructions BEFORE UPDATE OR DELETE ON costing_approval_instructions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_costing_evidence BEFORE UPDATE OR DELETE ON costing_approval_evidence FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
