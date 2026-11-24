-- Owner request, 24 Nov 2026: a bank programme order slot (for example CHP-163 · 154/250) is free again once its
-- site is cancelled, so the next new or renewed order can be issued with the same order number and the programme
-- stays inside its fixed number of slots. Freeing happens by itself; nobody releases a slot by hand.
--
-- Nothing saved is edited: issued IPOs, their numbers and documents stay as they are. A slot counts as free when
--  1. the Operations head cancelled the IPO's site (the immutable 'Site cancelled' board event, with proof), or
--  2. the IPO is an imported historical order that the reviewed source register lists as cancelled or transferred.
-- The same rule is used by the portal (server/project-workflow/order-slots.ts) through ipo_order_slot_released.

CREATE FUNCTION ipo_order_slot_released(ipo uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(
  SELECT 1 FROM operations_board_events e JOIN operations_board_versions v ON v.site_id=e.site_id AND v.version=e.site_version
  WHERE e.kind='Site cancelled' AND v.snapshot->>'cancelled'='true'
  AND (v.snapshot->'origin'->>'ipoId'=ipo::text OR EXISTS(SELECT 1 FROM inventory_material_source_links l WHERE l.ipo_id=ipo AND l.board_site_id=e.site_id))
 ) OR EXISTS(
  SELECT 1 FROM internal_purchase_orders i
  JOIN customer_purchase_orders p ON p.id=i.customer_po_id JOIN customers cu ON cu.id=p.customer_id
  CROSS JOIN LATERAL(SELECT snapshot FROM accounts_source_registers ORDER BY version DESC LIMIT 1) src
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(src.snapshot->'registers')='array' THEN src.snapshot->'registers' ELSE '[]'::jsonb END) reg
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(reg->'rows')='array' THEN reg->'rows' ELSE '[]'::jsonb END) r
  WHERE i.id=ipo
  AND COALESCE(i.snapshot->'historicalImport','null'::jsonb) NOT IN ('null'::jsonb,'false'::jsonb,'""'::jsonb,'0'::jsonb)
  AND r->>'kind'='UPS' AND (r->>'cancelled'='true' OR r->>'transferred'='true')
  AND upper(COALESCE(nullif(r->>'customer',''),split_part(r->>'key',':',1)))=upper(cu.short_code)
  AND upper(btrim(r->>'ipo'))=upper(regexp_replace(btrim(i.number),'-R[0-9]+$','','i'))
  AND btrim(r->>'orderNumber')=btrim(i.snapshot#>>'{input,orderNumber}')
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(src.snapshot->'registers')='array' THEN src.snapshot->'registers' ELSE '[]'::jsonb END) reg2
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(reg2->'rows')='array' THEN reg2->'rows' ELSE '[]'::jsonb END) active
   WHERE active->>'kind'='UPS' AND active->>'cancelled' IS DISTINCT FROM 'true' AND active->>'transferred' IS DISTINCT FROM 'true'
   AND upper(btrim(active->>'ipo'))=upper(btrim(r->>'ipo')) AND btrim(active->>'orderNumber')=btrim(r->>'orderNumber'))
 );
$$;

-- Migration 102 made "IPO number + order unit" unique with an index. An index cannot see cancellations, so the
-- shared UPS part of that rule moves into the existing insert guard below (which runs under the same advisory
-- lock as IPO number allocation). Every other IPO number stays unique with its own index, exactly as before.
CREATE UNIQUE INDEX internal_purchase_orders_number_key_non_shared ON internal_purchase_orders(lower(number))
 WHERE COALESCE(snapshot#>>'{approvedCommercialSource,key}','') NOT IN ('MBL-UPS-6-5','MBL-UPS-6-10','UBL-UPS-6-10');
-- Only where migration 102's rule exists (always, except in a test that replays 102 out of order).
DO $swap$
BEGIN
 IF to_regclass('internal_purchase_orders_number_order_key') IS NOT NULL THEN
  DROP INDEX internal_purchase_orders_number_order_key;
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
  IF split_part(unit,'/',1)::integer>split_part(unit,'/',2)::integer
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
END $swap$;
