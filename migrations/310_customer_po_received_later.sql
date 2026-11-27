-- User request, 24 Nov 2026 (Coordination, Atif): a site may go to installation on the customer's written approval
-- (email or WhatsApp screenshot) before the formal customer PO exists. When the PO arrives, Coordination attaches it
-- to the same site. Each attachment is a new row; the issued IPO, its number and its PDF are never changed.
-- A correction is a new version for the same site; earlier versions stay for the audit trail.
CREATE TABLE project_late_customer_pos (
 id uuid PRIMARY KEY,
 record_id uuid NOT NULL REFERENCES project_workflow_records(id),
 ipo_id uuid NOT NULL REFERENCES internal_purchase_orders(id),
 customer_id integer NOT NULL REFERENCES customers(id),
 version integer NOT NULL CHECK(version>0),
 po_number text NOT NULL CHECK(length(btrim(po_number)) BETWEEN 1 AND 100),
 po_date date NOT NULL,
 po_amount numeric(16,2) CHECK(po_amount IS NULL OR po_amount>=0),
 ipo_amount numeric(16,2),
 amount_differs boolean,
 file_id uuid NOT NULL REFERENCES project_workflow_files(id),
 notes text NOT NULL CHECK(length(btrim(notes)) BETWEEN 1 AND 4000),
 request_key uuid NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(record_id,version)
);
CREATE INDEX project_late_customer_pos_number ON project_late_customer_pos(customer_id,lower(po_number));
CREATE TRIGGER immutable_project_late_customer_pos BEFORE UPDATE OR DELETE ON project_late_customer_pos
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
