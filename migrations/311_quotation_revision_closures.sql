-- Close a quotation revision request that was resolved outside the portal (user request, 25 Nov 2026: the
-- Coordination "Revisions" tab was piling up with requests handled manually). Nothing is deleted: the request and
-- its history stay, and the closure (reason, who, when) is kept permanently. A closed request no longer counts as an
-- open revision anywhere that reads quotation_revision_requests_current.
CREATE TABLE quotation_revision_closures (
 request_id uuid PRIMARY KEY REFERENCES quotation_revision_requests(id),
 reason text NOT NULL CHECK(length(trim(reason))>=5),
 closed_by uuid NOT NULL REFERENCES users(id),
 closed_at timestamptz NOT NULL DEFAULT now(),
 request_key uuid UNIQUE NOT NULL
);
CREATE TRIGGER immutable_quotation_revision_closure BEFORE UPDATE OR DELETE ON quotation_revision_closures FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE OR REPLACE VIEW quotation_revision_requests_current AS
 SELECT q.id,q.source_quotation_id,q.origin,(q.costing_change OR s.request_id IS NOT NULL) AS costing_change,
 q.reason,q.requested_by,q.created_by,q.created_at,COALESCE(s.draft_id,q.draft_id) AS draft_id,q.request_key
 FROM quotation_revision_requests q LEFT JOIN quotation_revision_scope_changes s ON s.request_id=q.id
 WHERE NOT EXISTS(SELECT 1 FROM quotation_revision_closures c WHERE c.request_id=q.id);
