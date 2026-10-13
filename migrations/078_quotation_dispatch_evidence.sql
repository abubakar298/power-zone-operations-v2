CREATE TABLE quotation_dispatch_evidence(dispatch_id uuid NOT NULL REFERENCES quotation_dispatch_records(id),upload_id uuid NOT NULL REFERENCES survey_uploads(id),PRIMARY KEY(dispatch_id,upload_id));
CREATE TRIGGER immutable_quotation_dispatch_evidence BEFORE UPDATE OR DELETE ON quotation_dispatch_evidence FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
