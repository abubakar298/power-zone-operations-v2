-- Append an audited Operations version for a missing customer only when the
-- deterministic site ID AND saved handoff origin prove the exact IPO/customer.
-- No source IPO, invoice, receipt, stock, stage, date or signed evidence is rewritten.
DO $$
DECLARE item record; actor uuid; current_version integer; next_snapshot jsonb;
BEGIN
 SELECT id INTO actor FROM users WHERE active AND role='Admin' ORDER BY created_at,id LIMIT 1;
 FOR item IN
  WITH latest AS (SELECT DISTINCT ON(site_id) site_id,version,snapshot FROM operations_board_versions ORDER BY site_id,version DESC)
  SELECT b.*,i.id AS ipo_id,c.id AS customer_id,c.name AS customer_name
  FROM latest b JOIN internal_purchase_orders i ON b.site_id='live-ipo:'||i.id::text
  JOIN customer_purchase_orders po ON po.id=i.customer_po_id JOIN customers c ON c.id=po.customer_id
  WHERE b.snapshot#>>'{origin,kind}'='live-ipo-handoff' AND b.snapshot#>>'{origin,ipoId}'=i.id::text
  AND (NULLIF(btrim(b.snapshot->>'customer'),'') IS NULL OR lower(btrim(b.snapshot->>'customer')) IN ('customer not recorded','not recorded','unknown'))
  ORDER BY b.site_id
 LOOP
  IF actor IS NULL THEN RAISE EXCEPTION 'An active Administrator is required to audit exact IPO customer repairs'; END IF;
  PERFORM id FROM operations_board_sites WHERE id=item.site_id FOR UPDATE;
  SELECT max(version) INTO current_version FROM operations_board_versions WHERE site_id=item.site_id;
  IF current_version<>item.version THEN RAISE EXCEPTION 'Operations site changed during customer linking: %',item.site_id; END IF;
  next_snapshot=item.snapshot||jsonb_build_object('customer',item.customer_name,'customerId',item.customer_id,'customerLink',jsonb_build_object('basis','Exact saved IPO customer','ipoId',item.ipo_id,'previousCustomer',item.snapshot->'customer'));
  INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by)
   VALUES(item.site_id,item.version+1,next_snapshot,'Customer identity linked','Missing customer recovered from exact saved IPO and customer PO; workflow and financial history retained.',gen_random_uuid(),actor);
  INSERT INTO audit_log(user_id,action) VALUES(actor,'operations.board.customer-linked:'||item.site_id||':ipo:'||item.ipo_id::text);
 END LOOP;
END $$;
