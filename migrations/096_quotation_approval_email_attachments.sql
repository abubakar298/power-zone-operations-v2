-- Additive delivery cache only. Source quotations, financial snapshots and formats remain unchanged.
CREATE TABLE notification_email_attachments (
 notification_id uuid PRIMARY KEY REFERENCES notification_email_queue(id),
 source_key text NOT NULL,
 filename text NOT NULL,
 mime text NOT NULL CHECK(mime='application/pdf'),
 sha256 text NOT NULL CHECK(length(sha256)=64),
 content bytea NOT NULL CHECK(octet_length(content)>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_notification_email_attachment BEFORE UPDATE OR DELETE ON notification_email_attachments
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
