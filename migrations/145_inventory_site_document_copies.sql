-- Preserve immutable evidence while distinguishing per-site sign-offs from gate
-- copies. These additional evidence kinds never authorise stock posting.
ALTER TABLE inventory_gate_pass_copies ADD COLUMN source_site_id uuid;
ALTER TABLE inventory_gate_pass_copies DROP CONSTRAINT inventory_gate_pass_copies_copy_kind_check;
ALTER TABLE inventory_gate_pass_copies ADD CONSTRAINT inventory_gate_pass_copies_copy_kind_check CHECK(copy_kind IN('signed-gate','signed-store','signed-customer','customer-signoff'));
ALTER TABLE inventory_gate_pass_copies ADD CONSTRAINT inventory_site_signoff_scope CHECK((copy_kind='customer-signoff')=(source_site_id IS NOT NULL));
DO $$ DECLARE constraint_name text; BEGIN
 FOR constraint_name IN SELECT conname FROM pg_constraint WHERE conrelid='inventory_gate_pass_copies'::regclass AND contype='u' AND array_length(conkey,1)=4 LOOP
  EXECUTE format('ALTER TABLE inventory_gate_pass_copies DROP CONSTRAINT %I',constraint_name);
 END LOOP;
END $$;
ALTER TABLE inventory_gate_pass_copies ADD CONSTRAINT inventory_document_copy_site_unique UNIQUE NULLS NOT DISTINCT(document_kind,document_id,copy_kind,evidence_id,source_site_id);
