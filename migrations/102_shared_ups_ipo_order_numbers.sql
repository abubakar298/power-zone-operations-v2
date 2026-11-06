-- UPS batch IPOs share their printed number; each order remains a separate job.
-- Existing document snapshots and registry roots remain unchanged.
CREATE TABLE document_reference_aliases (
 document_type text NOT NULL CHECK(document_type='IPO'),
 family_id uuid NOT NULL,
 reference text NOT NULL REFERENCES document_reference_roots(reference),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(document_type,family_id)
);
CREATE TRIGGER immutable_document_reference_alias BEFORE UPDATE OR DELETE ON document_reference_aliases FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

ALTER TABLE internal_purchase_orders DROP CONSTRAINT internal_purchase_orders_number_key;
CREATE UNIQUE INDEX internal_purchase_orders_number_order_key ON internal_purchase_orders (
 lower(number),
 (CASE WHEN snapshot#>>'{approvedCommercialSource,key}' IN ('MBL-UPS-6-5','MBL-UPS-6-10','UBL-UPS-6-10')
 THEN split_part(snapshot#>>'{approvedCommercialSource,key}','-',1)||':'||split_part(COALESCE(snapshot#>>'{input,orderNumber}',''),'/',1)
 ELSE '' END)
);

CREATE FUNCTION guard_shared_ups_ipo_number() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior record; customer integer; unit text; config text;
BEGIN
 PERFORM pg_advisory_xact_lock(742019040);
 config := NEW.snapshot#>>'{approvedCommercialSource,key}';
 unit := COALESCE(NEW.snapshot#>>'{input,orderNumber}','');
 SELECT customer_id INTO customer FROM customer_purchase_orders WHERE id=NEW.customer_po_id;
 FOR prior IN SELECT i.snapshot,p.customer_id FROM internal_purchase_orders i JOIN customer_purchase_orders p ON p.id=i.customer_po_id WHERE lower(i.number)=lower(NEW.number)
 LOOP
  IF config IS NULL OR config NOT IN ('MBL-UPS-6-5','MBL-UPS-6-10','UBL-UPS-6-10')
   OR COALESCE(prior.snapshot#>>'{approvedCommercialSource,key}','') NOT IN ('MBL-UPS-6-5','MBL-UPS-6-10','UBL-UPS-6-10')
   OR prior.customer_id<>customer
   OR unit !~ '^[1-9][0-9]{0,5}/[1-9][0-9]{0,5}$'
   OR COALESCE(prior.snapshot#>>'{input,orderNumber}','') !~ '^[1-9][0-9]{0,5}/[1-9][0-9]{0,5}$'
  THEN RAISE EXCEPTION 'This IPO number and order number are already in use or belong to a different order batch.' USING ERRCODE='23505';
  END IF;
  IF split_part(unit,'/',1)::integer>split_part(unit,'/',2)::integer
   OR split_part(unit,'/',1)=split_part(prior.snapshot#>>'{input,orderNumber}','/',1)
   OR split_part(unit,'/',2)<>split_part(prior.snapshot#>>'{input,orderNumber}','/',2)
  THEN RAISE EXCEPTION 'This IPO number and order number are already in use or belong to a different order batch.' USING ERRCODE='23505';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER shared_ups_ipo_number BEFORE INSERT ON internal_purchase_orders FOR EACH ROW EXECUTE FUNCTION guard_shared_ups_ipo_number();
