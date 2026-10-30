-- Preserve preliminary BOQ snapshots while allowing preparation edits before a quotation exists.
CREATE TABLE boq_preparation_edits(
 draft_id uuid PRIMARY KEY REFERENCES survey_drafts(id),
 source_revision_id uuid NOT NULL REFERENCES boq_revisions(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_revision_id,created_by)
);
CREATE TRIGGER immutable_boq_preparation_edit BEFORE UPDATE OR DELETE ON boq_preparation_edits FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
