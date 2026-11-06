CREATE TABLE informational_technical_reports (
 id uuid PRIMARY KEY,
 record_id uuid NOT NULL REFERENCES project_workflow_records(id),
 source_review_id uuid NOT NULL REFERENCES project_workflow_documents(id),
 document_id uuid UNIQUE NOT NULL REFERENCES project_workflow_documents(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(record_id,source_review_id)
);
CREATE TRIGGER immutable_informational_technical_report BEFORE UPDATE OR DELETE ON informational_technical_reports FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
ALTER VIEW notification_events RENAME TO before_informational_technical_report_events;
CREATE VIEW notification_events AS
 SELECT * FROM before_informational_technical_report_events
 UNION ALL
 SELECT 'technical-information:'||t.id,'technical-information:'||t.id,
 'Technical report submitted',c.short_code||' · '||r.site_name||' ('||r.site_code||')',t.created_by,t.created_at,
 NULL::uuid,'management',
 jsonb_build_object('url','/api/project-workflow/'||r.id||'/documents/'||t.document_id||'/pdf'),false
 FROM informational_technical_reports t JOIN project_workflow_records r ON r.id=t.record_id JOIN customers c ON c.id=r.customer_id;
