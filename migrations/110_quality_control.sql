-- Quality Control (Moaz, 26 Oct 2026). A new role whose in-charge uploads each site's delivery and installation
-- documents. Shaigan and the Accounts people Admin names are told on every submission and can view them, read only.
-- Submitted documents are permanent. Deadlines are worked out in the application: delivery papers in the first three
-- working hours of the next working day (Mon-Fri, 9:00-18:00, Pakistan time), BESS installation papers within three
-- calendar days of BESS delivery. A site cannot close until every required document is submitted.
ALTER TABLE roles DROP CONSTRAINT roles_name_check;
ALTER TABLE roles ADD CONSTRAINT roles_name_check CHECK(name IN('Admin','Management','Employee','Coordinator','Operations','Inventory','Accounts','Design','Quality Control'));
INSERT INTO roles(name) VALUES('Quality Control');

-- Solar and BESS often arrive on different days; a Solar + BESS site records both.
ALTER TABLE site_workflow ADD COLUMN bess_delivered_on date;

-- Who may view the documents, granted by Admin by exact email (Store and Accounts logins).
CREATE TABLE qc_access (
 user_id uuid NOT NULL REFERENCES users(id),
 capability text NOT NULL CHECK (capability IN ('viewer')),
 granted_reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, capability)
);
CREATE TABLE qc_access_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id),
 capability text NOT NULL CHECK (capability IN ('viewer')),
 action text NOT NULL CHECK (action IN ('grant','remove')),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
 actor uuid NOT NULL REFERENCES users(id),
 ip text NOT NULL DEFAULT '',
 device text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_qc_access_events BEFORE UPDATE OR DELETE ON qc_access_events
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

-- One submission per document per press of "Submit"; on_time is judged against the deadline at that moment.
CREATE TABLE qc_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workflow_id uuid NOT NULL REFERENCES site_workflow(id),
 kind text NOT NULL CHECK (kind IN ('solar_dc','bess_dc','installation','cable_variance','acknowledgement')),
 note text NOT NULL DEFAULT '',
 due_at timestamptz,
 on_time boolean,
 submitted_by uuid NOT NULL REFERENCES users(id),
 submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX qc_submissions_site ON qc_submissions(workflow_id, kind);
CREATE TRIGGER immutable_qc_submissions BEFORE UPDATE OR DELETE ON qc_submissions
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

-- Files: attached first (removable), then locked forever once submitted. Pictures are shrunk in the browser.
CREATE TABLE qc_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workflow_id uuid NOT NULL REFERENCES site_workflow(id),
 kind text NOT NULL CHECK (kind IN ('solar_dc','bess_dc','installation','cable_variance','acknowledgement')),
 submission_id uuid REFERENCES qc_submissions(id),
 filename text NOT NULL CHECK (length(btrim(filename)) BETWEEN 1 AND 200),
 mime text NOT NULL CHECK (mime IN ('image/jpeg','image/png','application/pdf')),
 size integer NOT NULL CHECK (size > 0 AND size <= 8388608),
 original_size integer NOT NULL CHECK (original_size > 0),
 sha256 text NOT NULL,
 content bytea NOT NULL CHECK (octet_length(content) = size),
 uploaded_by uuid NOT NULL REFERENCES users(id),
 uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX qc_files_site ON qc_files(workflow_id, kind);
CREATE FUNCTION qc_files_locked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.submission_id IS NOT NULL THEN
    RAISE EXCEPTION 'Submitted QC documents cannot be changed or removed';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.content IS DISTINCT FROM OLD.content OR NEW.kind <> OLD.kind OR NEW.workflow_id <> OLD.workflow_id) THEN
    RAISE EXCEPTION 'An attached QC document cannot be changed; remove it and attach it again';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER qc_files_locked BEFORE UPDATE OR DELETE ON qc_files FOR EACH ROW EXECUTE FUNCTION qc_files_locked();

-- Notices to the viewers on every submission, through the bell and the existing email queue (as in 091, 104, 109).
CREATE TABLE qc_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id),
 workflow_id uuid NOT NULL REFERENCES site_workflow(id),
 submission_id uuid NOT NULL REFERENCES qc_submissions(id),
 reference text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (user_id, submission_id)
);
CREATE TRIGGER immutable_qc_notices BEFORE UPDATE OR DELETE ON qc_notices
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
ALTER VIEW notification_events RENAME TO before_qc_notice_events;
CREATE VIEW notification_events AS
 SELECT * FROM before_qc_notice_events
 UNION ALL
 SELECT 'qc-notice:'||n.id, 'qc-site:'||n.workflow_id, 'QC documents submitted', n.reference, NULL::uuid, n.created_at,
 n.user_id, u.role, jsonb_build_object('target','qc-documents','workflowId',n.workflow_id), false
 FROM qc_notices n JOIN users u ON u.id=n.user_id;
INSERT INTO notification_types(kind, title, email_enabled) VALUES ('QC documents submitted', 'Site documents submitted by Quality Control', true);
