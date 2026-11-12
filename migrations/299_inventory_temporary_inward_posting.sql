CREATE TABLE inventory_temporary_inward_postings (
 document_id uuid PRIMARY KEY,
 document_version integer NOT NULL,
 warehouse text NOT NULL,
 external_reference text NOT NULL CHECK (length(btrim(external_reference)) > 0),
 snapshot jsonb NOT NULL,
 posted_by uuid NOT NULL REFERENCES users(id),
 posted_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (document_id,document_version) REFERENCES inventory_temporary_document_versions(document_id,version)
);

CREATE UNIQUE INDEX inventory_temporary_inward_reference_once
 ON inventory_temporary_inward_postings(warehouse,lower(btrim(external_reference)));

CREATE TRIGGER immutable_inventory_temporary_inward_posting
 BEFORE UPDATE OR DELETE ON inventory_temporary_inward_postings
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

ALTER TABLE inventory_warehouse_operational_movements
 ADD COLUMN temporary_inward_id uuid REFERENCES inventory_temporary_inward_postings(document_id);

CREATE UNIQUE INDEX inventory_temporary_inward_movement_once
 ON inventory_warehouse_operational_movements(temporary_inward_id,ledger_key)
 WHERE temporary_inward_id IS NOT NULL;

DO $$
DECLARE existing text;
BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT existing
 FROM pg_constraint
 WHERE conrelid='inventory_warehouse_operational_movements'::regclass AND conname='warehouse_movement_source';
 ALTER TABLE inventory_warehouse_operational_movements DROP CONSTRAINT warehouse_movement_source;
 EXECUTE 'ALTER TABLE inventory_warehouse_operational_movements ADD CONSTRAINT warehouse_movement_source CHECK('
  || '(temporary_inward_id IS NULL AND (' || existing || ')) OR '
  || '(kind=''temporary-inward'' AND temporary_inward_id IS NOT NULL '
  || 'AND num_nonnulls(draft_id,dispatch_id,line_key,receipt_id,purchase_receipt_id,purchase_line_id,'
  || 'transfer_id,transfer_line_key,transfer_receipt_id,replacement_dispatch_id,replacement_release_id)=0 '
  || 'AND in_delta>0 AND out_delta=0 AND closing_before IS NOT NULL AND closing_after IS NOT NULL))';
END $$;
