-- Mark an approved BOQ as "Not needed" (user decision, 27 Nov 2026: a duplicate Quick BOQ made before a full survey
-- of the same site stayed in Coordination's Design Review with no way to clear it). Nothing is deleted: the BOQ and
-- its history stay, and the retirement (reason, who, when) is kept permanently. A retired BOQ leaves the work lists.
CREATE TABLE boq_retirements (
 revision_id uuid PRIMARY KEY REFERENCES boq_revisions(id),
 reason text NOT NULL CHECK(length(trim(reason))>=5),
 retired_by uuid NOT NULL REFERENCES users(id),
 retired_at timestamptz NOT NULL DEFAULT now(),
 request_key uuid UNIQUE NOT NULL
);
CREATE TRIGGER immutable_boq_retirement BEFORE UPDATE OR DELETE ON boq_retirements FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
