-- Warehouse requests may buy a reviewed final stock ID even before its first Rate Master entry.
CREATE OR REPLACE FUNCTION procurement_item_exists() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM item_master WHERE key=NEW.item_key)
     OR EXISTS (SELECT 1 FROM misc_items WHERE key=NEW.item_key) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM inventory_final_stock_ids WHERE item_id=NEW.item_key)
     AND EXISTS (SELECT 1 FROM purchase_request_events WHERE request_id=NEW.request_id
       AND kind='created' AND changes->>'requiresAccounts'='true') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Item % is not in the rate master or the misc items list', NEW.item_key USING ERRCODE='foreign_key_violation';
END $$;

ALTER TABLE purchase_quotes ADD COLUMN expected_on date;
ALTER TABLE purchase_quotes ADD COLUMN vendor_terms text NOT NULL DEFAULT '';
