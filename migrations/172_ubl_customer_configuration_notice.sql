-- New forward-only customer PO changes. No historical change or notification replay.
CREATE TABLE ubl_customer_configuration_changes(
 id uuid PRIMARY KEY,record_id uuid NOT NULL REFERENCES project_workflow_records(id),receipt_id uuid NOT NULL UNIQUE REFERENCES project_po_receipts(id),
 snapshot jsonb NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_ubl_customer_configuration_change BEFORE UPDATE OR DELETE ON ubl_customer_configuration_changes FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
INSERT INTO notification_types(kind,title,email_enabled) VALUES('UBL configuration changed','UBL customer configuration changed',true);
ALTER VIEW notification_events RENAME TO before_ubl_customer_configuration_events;
CREATE VIEW notification_events AS SELECT * FROM before_ubl_customer_configuration_events
UNION ALL
SELECT 'ubl-config-change:'||e.id,'ubl-config-change:'||e.id,'UBL configuration changed',
 concat_ws(' | ',r.site_name,r.site_code,(e.snapshot#>>'{recommended,source,key}')||' → '||(e.snapshot#>>'{ordered,source,key}'),(e.snapshot->>'poReference')),
 e.created_by,e.created_at,NULL::uuid,'management'::text,
 jsonb_build_object('target','coordination','kind','Project workflow','workflow_id',r.id,'id',r.id),false
FROM ubl_customer_configuration_changes e JOIN project_workflow_records r ON r.id=e.record_id;
