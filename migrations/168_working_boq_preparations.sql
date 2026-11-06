-- Working preparations retain one preliminary identity until quotation creation.
-- Existing rows and approved document snapshots are not changed by this migration.
CREATE TABLE boq_working_preparations (
 revision_id uuid PRIMARY KEY REFERENCES boq_revisions(id),
 draft_id uuid NOT NULL UNIQUE REFERENCES survey_drafts(id),
 updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE boq_working_changes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 revision_id uuid NOT NULL REFERENCES boq_revisions(id),
 draft_version integer NOT NULL,
 before_snapshot jsonb NOT NULL, after_snapshot jsonb NOT NULL,
 changed_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_working_boq_change BEFORE UPDATE OR DELETE ON boq_working_changes FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TABLE boq_stale_pricing (
 pricing_id uuid PRIMARY KEY REFERENCES commercial_pricing_versions(id),
 revision_id uuid NOT NULL REFERENCES boq_revisions(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_stale_boq_pricing BEFORE UPDATE OR DELETE ON boq_stale_pricing FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE FUNCTION protect_boq_preparation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE working boq_working_preparations; draft_version integer;
BEGIN
 IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'Saved BOQ records are immutable and cannot be deleted'; END IF;
 SELECT * INTO working FROM boq_working_preparations WHERE revision_id=OLD.id;
 IF working.revision_id IS NULL OR (to_jsonb(NEW)-'snapshot') IS DISTINCT FROM (to_jsonb(OLD)-'snapshot')
 OR NOT EXISTS(SELECT 1 FROM boq_preliminary_references WHERE revision_id=OLD.id)
 OR EXISTS(SELECT 1 FROM boq_customer_final_references WHERE revision_id=OLD.id)
 OR EXISTS(SELECT 1 FROM quotation_versions WHERE boq_revision_id=OLD.id)
 OR EXISTS(SELECT 1 FROM customer_purchase_orders WHERE boq_revision_id=OLD.id)
 OR EXISTS(SELECT 1 FROM boq_draft_finalizations f JOIN boq_review_submissions s ON s.draft_id=f.draft_id JOIN boq_review_decisions d ON d.submission_id=s.id WHERE f.revision_id=OLD.id AND d.outcome='Approved')
 OR OLD.id <> (SELECT id FROM boq_revisions WHERE boq_id=OLD.boq_id ORDER BY revision DESC LIMIT 1)
 THEN RAISE EXCEPTION 'Saved BOQ is immutable and locked; create a revision'; END IF;
 IF NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN
  SELECT version INTO draft_version FROM survey_drafts WHERE id=working.draft_id;
  INSERT INTO boq_working_changes(revision_id,draft_version,before_snapshot,after_snapshot,changed_by)
   VALUES(OLD.id,draft_version,OLD.snapshot,NEW.snapshot,working.updated_by);
  INSERT INTO boq_stale_pricing(pricing_id,revision_id)
   SELECT id,OLD.id FROM commercial_pricing_versions WHERE boq_revision_id=OLD.id ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER immutable_boq_revision ON boq_revisions;
CREATE TRIGGER immutable_boq_revision BEFORE UPDATE OR DELETE ON boq_revisions FOR EACH ROW EXECUTE FUNCTION protect_boq_preparation();
CREATE TABLE quotation_revision_scope_changes (
 request_id uuid PRIMARY KEY REFERENCES quotation_revision_requests(id),
 draft_id uuid NOT NULL UNIQUE REFERENCES survey_drafts(id),
 changed_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_revision_scope_change BEFORE UPDATE OR DELETE ON quotation_revision_scope_changes FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE VIEW quotation_revision_requests_current AS
 SELECT q.id,q.source_quotation_id,q.origin,(q.costing_change OR s.request_id IS NOT NULL) AS costing_change,
 q.reason,q.requested_by,q.created_by,q.created_at,COALESCE(s.draft_id,q.draft_id) AS draft_id,q.request_key
 FROM quotation_revision_requests q LEFT JOIN quotation_revision_scope_changes s ON s.request_id=q.id;
