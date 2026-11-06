ALTER TABLE survey_drafts ADD COLUMN revision_origin text CHECK(revision_origin IN ('Internal management','Customer'));
ALTER TABLE boq_revisions ADD COLUMN revision_origin text CHECK(revision_origin IN ('Internal management','Customer'));
CREATE TABLE quotation_revision_requests (
 id uuid PRIMARY KEY, source_quotation_id uuid NOT NULL REFERENCES quotation_versions(id),
 origin text NOT NULL CHECK(origin IN ('Internal management','Customer')),
 costing_change boolean NOT NULL, reason text NOT NULL CHECK(length(trim(reason))>0),
 requested_by text NOT NULL CHECK(length(trim(requested_by))>0),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 draft_id uuid UNIQUE REFERENCES survey_drafts(id), request_key uuid UNIQUE NOT NULL
);
CREATE TABLE quotation_revision_links (
 quotation_id uuid PRIMARY KEY REFERENCES quotation_versions(id),
 request_id uuid UNIQUE NOT NULL REFERENCES quotation_revision_requests(id)
);
CREATE TRIGGER immutable_quote_revision_requests BEFORE UPDATE OR DELETE ON quotation_revision_requests FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_quote_revision_links BEFORE UPDATE OR DELETE ON quotation_revision_links FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
