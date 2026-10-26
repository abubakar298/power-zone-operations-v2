-- Append-only receipt binding changes. Original bindings and evidence remain immutable.
CREATE TABLE headsup_site_binding_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 record_id uuid NOT NULL REFERENCES project_workflow_records(id),
 receipt_id uuid NOT NULL REFERENCES customer_headsup_receipts(id),
 source_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN('Received','Released')),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_headsup_binding_event BEFORE UPDATE OR DELETE ON headsup_site_binding_events FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE VIEW active_headsup_received_sites AS
 WITH latest AS (SELECT DISTINCT ON(record_id) * FROM headsup_site_binding_events ORDER BY record_id,id DESC)
 SELECT record_id,receipt_id,source_key,created_by,created_at FROM latest WHERE kind='Received'
 UNION ALL SELECT b.record_id,b.receipt_id,b.source_key,b.created_by,b.created_at FROM headsup_received_sites b WHERE NOT EXISTS(SELECT 1 FROM latest e WHERE e.record_id=b.record_id);
