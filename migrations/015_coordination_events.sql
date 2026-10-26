CREATE TABLE coordination_events (
 id uuid PRIMARY KEY, quotation_id uuid NOT NULL REFERENCES quotation_versions(id),
 kind text NOT NULL CHECK(kind IN ('Submitted','Approved','Changes requested','PO received')),
 notes text NOT NULL DEFAULT '', created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(quotation_id,kind)
);
CREATE TRIGGER immutable_coordination_event BEFORE UPDATE OR DELETE ON coordination_events FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
