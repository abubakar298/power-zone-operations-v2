-- Owner request, 25 Nov 2026: the UBL UPS 250 programme (agreement UBL-UPS-6-10, target 250) has no hard ceiling.
-- When more orders come than its original 250, they are issued as 251/250, 252/250 and so on, shown in the portal
-- as "Extra order (250+)". No approval is needed. Slots freed by cancelled sites are used first (the portal checks
-- that before issuing: server/project-workflow/order-slots.ts requireFreedSlotsFirst).
-- The rule list lives in shared/extra-programme-orders.ts; this guard follows it and tests keep the two in step.
--
-- Nothing saved is edited: issued IPOs, their order numbers and documents stay as they are. Only the insert guard
-- from migration 309 changes, in one place: a unit above its total is now allowed for UBL-UPS-6-10 orders whose
-- total is 250. Every other check is the same as before (same total on one IPO, same unit refused unless freed).

DO $extra$
BEGIN
 -- Only where migration 309 replaced the guard (always, except in a test that replays 102 out of order).
 IF to_regprocedure('guard_shared_ups_ipo_number()') IS NOT NULL AND to_regclass('internal_purchase_orders_number_order_key') IS NULL THEN
  EXECUTE $sql$
CREATE OR REPLACE FUNCTION guard_shared_ups_ipo_number() RETURNS trigger LANGUAGE plpgsql AS $guard$
DECLARE prior record; customer integer; unit text; config text;
BEGIN
 PERFORM pg_advisory_xact_lock(742019040);
 config := NEW.snapshot#>>'{approvedCommercialSource,key}';
 unit := COALESCE(NEW.snapshot#>>'{input,orderNumber}','');
 SELECT customer_id INTO customer FROM customer_purchase_orders WHERE id=NEW.customer_po_id;
 FOR prior IN SELECT i.id,i.snapshot,p.customer_id FROM internal_purchase_orders i JOIN customer_purchase_orders p ON p.id=i.customer_po_id WHERE lower(i.number)=lower(NEW.number)
 LOOP
  IF config IS NULL OR config NOT IN ('MBL-UPS-6-5','MBL-UPS-6-10','UBL-UPS-6-10')
   OR COALESCE(prior.snapshot#>>'{approvedCommercialSource,key}','') NOT IN ('MBL-UPS-6-5','MBL-UPS-6-10','UBL-UPS-6-10')
   OR prior.customer_id<>customer
   OR unit !~ '^[1-9][0-9]{0,5}/[1-9][0-9]{0,5}$'
   OR COALESCE(prior.snapshot#>>'{input,orderNumber}','') !~ '^[1-9][0-9]{0,5}/[1-9][0-9]{0,5}$'
  THEN RAISE EXCEPTION 'This IPO number and order number are already in use or belong to a different order batch.' USING ERRCODE='23505';
  END IF;
  -- A unit above its total is an extra order: allowed only for the growing UBL UPS 250 programme.
  IF (split_part(unit,'/',1)::integer>split_part(unit,'/',2)::integer AND NOT (config='UBL-UPS-6-10' AND split_part(unit,'/',2)='250'))
   OR split_part(unit,'/',2)<>split_part(prior.snapshot#>>'{input,orderNumber}','/',2)
  THEN RAISE EXCEPTION 'This IPO number and order number are already in use or belong to a different order batch.' USING ERRCODE='23505';
  END IF;
  -- The same order unit is refused unless the earlier order's site was cancelled (its slot is free again).
  IF split_part(unit,'/',1)=split_part(prior.snapshot#>>'{input,orderNumber}','/',1) THEN
   IF NOT ipo_order_slot_released(prior.id) THEN
    RAISE EXCEPTION 'This IPO number and order number are already in use or belong to a different order batch.' USING ERRCODE='23505';
   END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $guard$
$sql$;
 END IF;
END $extra$;
