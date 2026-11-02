-- Preserve native DO foreign keys; historical external references carry no invented original stock movement.
ALTER TABLE inventory_material_replacement_cases ALTER COLUMN original_dispatch_id DROP NOT NULL, ALTER COLUMN original_line_key DROP NOT NULL;
ALTER TABLE inventory_material_replacement_cases ADD COLUMN external_do_reference text;
ALTER TABLE inventory_material_replacement_cases ADD CONSTRAINT replacement_original_reference CHECK (
 (original_dispatch_id IS NOT NULL AND original_line_key IS NOT NULL AND external_do_reference IS NULL) OR
 (original_dispatch_id IS NULL AND original_line_key IS NULL AND external_do_reference IS NOT NULL AND length(btrim(external_do_reference)) BETWEEN 1 AND 200));
ALTER TABLE inventory_material_replacement_dispatches ALTER COLUMN original_dispatch_id DROP NOT NULL, ALTER COLUMN original_line_key DROP NOT NULL;
ALTER TABLE inventory_material_replacement_usable_releases ALTER COLUMN original_dispatch_id DROP NOT NULL, ALTER COLUMN original_line_key DROP NOT NULL;
DO $$ DECLARE existing text; BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO existing FROM pg_constraint WHERE conrelid='inventory_warehouse_operational_movements'::regclass AND conname='warehouse_movement_source';
 IF existing IS NULL THEN RAISE EXCEPTION 'Warehouse movement source constraint is required'; END IF;
 ALTER TABLE inventory_warehouse_operational_movements DROP CONSTRAINT warehouse_movement_source;
 EXECUTE 'ALTER TABLE inventory_warehouse_operational_movements ADD CONSTRAINT warehouse_movement_source CHECK(('||existing||') OR '
 ||'(draft_id IS NULL AND dispatch_id IS NULL AND line_key IS NULL AND receipt_id IS NULL AND purchase_receipt_id IS NULL AND purchase_line_id IS NULL AND transfer_id IS NULL AND transfer_line_key IS NULL AND transfer_receipt_id IS NULL AND '
 ||'((kind=''replacement-out'' AND replacement_dispatch_id IS NOT NULL AND replacement_release_id IS NULL AND in_delta=0 AND out_delta>0) OR '
 ||'(kind=''replacement-usable-in'' AND replacement_dispatch_id IS NULL AND replacement_release_id IS NOT NULL AND in_delta>0 AND out_delta=0))))';
END $$;
