ALTER TABLE customer_headsup_receipts ADD COLUMN supersedes_id uuid REFERENCES customer_headsup_receipts(id);
CREATE UNIQUE INDEX headsup_one_successor ON customer_headsup_receipts(supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE TABLE headsup_change_history(id uuid PRIMARY KEY,receipt_id uuid NOT NULL REFERENCES customer_headsup_receipts(id),source_receipt_id uuid REFERENCES customer_headsup_receipts(id),changes jsonb NOT NULL,reason text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE headsup_department_handoffs(id uuid PRIMARY KEY,receipt_id uuid UNIQUE NOT NULL REFERENCES customer_headsup_receipts(id),number text NOT NULL,snapshot jsonb NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE headsup_advance_members(record_id uuid PRIMARY KEY REFERENCES project_workflow_records(id),handoff_id uuid NOT NULL REFERENCES headsup_department_handoffs(id));
CREATE TRIGGER immutable_headsup_change BEFORE UPDATE OR DELETE ON headsup_change_history FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_headsup_handoff BEFORE UPDATE OR DELETE ON headsup_department_handoffs FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_headsup_advance_member BEFORE UPDATE OR DELETE ON headsup_advance_members FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
