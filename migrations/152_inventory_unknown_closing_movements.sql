-- Record real physical quantities even when a historical opening is missing.
-- Keep that opening/closing unknown; never manufacture a zero balance.
ALTER TABLE inventory_warehouse_operational_movements
 ALTER COLUMN closing_before DROP NOT NULL,
 ALTER COLUMN closing_after DROP NOT NULL;
ALTER TABLE inventory_warehouse_operational_movements
 ADD CONSTRAINT warehouse_movement_closing_pair CHECK((closing_before IS NULL)=(closing_after IS NULL));
CREATE FUNCTION inventory_movement_unknown_closing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.closing_before IS NULL AND NOT EXISTS(
  SELECT 1 FROM inventory_warehouse_source_balances
  WHERE source_sha256=NEW.source_sha256 AND ledger_key=NEW.ledger_key
   AND payload->'calculatedClosing'='null'::jsonb
 ) THEN
  RAISE EXCEPTION 'A known warehouse closing cannot be omitted from a movement';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_movement_unknown_closing_guard
 BEFORE INSERT ON inventory_warehouse_operational_movements
 FOR EACH ROW EXECUTE FUNCTION inventory_movement_unknown_closing();
