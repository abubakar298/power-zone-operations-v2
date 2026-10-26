CREATE TABLE quotation_dispatch_records (
 id uuid PRIMARY KEY,
 quotation_id uuid REFERENCES quotation_versions(id),
 cni_version_id uuid REFERENCES cni_proposal_versions(id),
 recipient text NOT NULL CHECK(recipient IN ('Customer','Salesperson')),
 notes text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(quotation_id,cni_version_id)=1),
 UNIQUE(quotation_id), UNIQUE(cni_version_id)
);
CREATE TRIGGER quotation_dispatch_immutable BEFORE UPDATE OR DELETE ON quotation_dispatch_records
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TABLE cni_external_approvals (
 id uuid PRIMARY KEY, version_id uuid NOT NULL UNIQUE REFERENCES cni_proposal_versions(id),
 evidence jsonb NOT NULL, recorded_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cni_external_approval_files (
 approval_id uuid NOT NULL REFERENCES cni_external_approvals(id), upload_id uuid NOT NULL REFERENCES survey_uploads(id), PRIMARY KEY(approval_id,upload_id)
);
CREATE TRIGGER cni_external_approval_immutable BEFORE UPDATE OR DELETE ON cni_external_approvals FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER cni_external_approval_file_immutable BEFORE UPDATE OR DELETE ON cni_external_approval_files FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
