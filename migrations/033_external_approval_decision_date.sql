-- Historical recording dates are not assumed to be the actual decision date.
ALTER TABLE external_document_approvals ADD COLUMN decision_at timestamptz;
