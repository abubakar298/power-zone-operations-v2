CREATE TABLE boq_preliminary_references (
 revision_id uuid PRIMARY KEY REFERENCES boq_revisions(id),number text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE boq_customer_final_references (
 revision_id uuid PRIMARY KEY REFERENCES boq_revisions(id),quotation_id uuid NOT NULL REFERENCES quotation_versions(id),
 number text NOT NULL UNIQUE,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_preliminary_boq_reference BEFORE UPDATE OR DELETE ON boq_preliminary_references FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_customer_final_boq_reference BEFORE UPDATE OR DELETE ON boq_customer_final_references FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
-- Add classification to unsent Design-generated BOQs without rewriting their original snapshots or references.
INSERT INTO boq_preliminary_references(revision_id,number)
SELECT DISTINCT b.id,'PBQ-REVIEW-'||upper(left(b.id::text,8)) FROM boq_revisions b
JOIN boq_draft_finalizations f ON f.revision_id=b.id
JOIN project_workflow_records r ON r.data->>'draftId'=f.draft_id::text
WHERE r.data->>'designHandoffAt' IS NOT NULL AND r.route='survey-quote'
AND NOT EXISTS(SELECT 1 FROM quotation_versions q JOIN quotation_dispatch_records d ON d.quotation_id=q.id WHERE q.boq_revision_id=b.id);
