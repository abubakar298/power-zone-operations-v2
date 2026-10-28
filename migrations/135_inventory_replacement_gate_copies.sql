-- Add replacement document copies only; existing signed copies and stock stay unchanged.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='inventory_gate_pass_copies'::regclass AND contype='c' AND (SELECT attnum FROM pg_attribute WHERE attrelid=conrelid AND attname='document_kind')=ANY(conkey)
 LOOP EXECUTE format('ALTER TABLE inventory_gate_pass_copies DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
ALTER TABLE inventory_gate_pass_copies ADD CONSTRAINT inventory_gate_pass_document_kind CHECK(document_kind IN('dispatch','return','purchase','transfer-out','transfer-in','replacement-out','replacement-in'));
