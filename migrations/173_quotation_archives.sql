CREATE TABLE quotation_archive_events (
 id uuid PRIMARY KEY,
 quotation_id uuid REFERENCES quotation_versions(id),
 cni_proposal_id uuid REFERENCES cni_proposals(id),
 archived boolean NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (num_nonnulls(quotation_id,cni_proposal_id)=1)
);
CREATE INDEX quotation_archive_events_quote ON quotation_archive_events(quotation_id,created_at DESC);
CREATE INDEX quotation_archive_events_cni ON quotation_archive_events(cni_proposal_id,created_at DESC);
CREATE TRIGGER immutable_quotation_archive_event BEFORE UPDATE OR DELETE ON quotation_archive_events
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE VIEW quotation_archives_current AS
 SELECT DISTINCT ON (COALESCE(quotation_id,cni_proposal_id)) *
 FROM quotation_archive_events ORDER BY COALESCE(quotation_id,cni_proposal_id),created_at DESC,id DESC;
