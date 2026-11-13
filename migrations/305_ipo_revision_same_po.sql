-- An approved IPO revision is issued under the same customer PO as the IPO it revises (no new PO
-- header). Only that case is let through: the IPO it revises must sit under this PO for the same
-- site record, and a matching undecided revision proposal must exist. Every other insert keeps the
-- one-IPO-per-site-per-PO and approved-batch guards exactly as before.
CREATE OR REPLACE FUNCTION protect_shared_configuration_po() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch uuid;
BEGIN
 PERFORM 1 FROM customer_purchase_orders WHERE id=NEW.customer_po_id FOR UPDATE;
 IF NEW.snapshot ? 'ipoRevision'
  AND EXISTS(SELECT 1 FROM internal_purchase_orders o WHERE o.id::text=NEW.snapshot->'ipoRevision'->>'revisesIpoId' AND o.customer_po_id=NEW.customer_po_id AND o.snapshot->>'workflowRecordId'=NEW.snapshot->>'workflowRecordId')
  AND EXISTS(SELECT 1 FROM ipo_revision_proposals p WHERE p.number=NEW.number AND p.snapshot->'ipoRevision'->>'revisesIpoId'=NEW.snapshot->'ipoRevision'->>'revisesIpoId' AND NOT EXISTS(SELECT 1 FROM ipo_revision_decisions d WHERE d.proposal_id=p.id))
 THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM internal_purchase_orders WHERE customer_po_id=NEW.customer_po_id AND snapshot->>'workflowRecordId'=NEW.snapshot->>'workflowRecordId') THEN RAISE EXCEPTION 'duplicate key: This site already has an IPO under the customer PO' USING ERRCODE='23505';END IF;
 IF EXISTS(SELECT 1 FROM internal_purchase_orders WHERE customer_po_id=NEW.customer_po_id) THEN
 SELECT s.batch_id INTO batch FROM approved_configuration_batch_sites s JOIN approved_configuration_batch_pos p ON p.batch_id=s.batch_id WHERE s.record_id::text=NEW.snapshot->>'workflowRecordId' AND p.customer_po_id=NEW.customer_po_id;
 IF batch IS NULL OR EXISTS(SELECT 1 FROM internal_purchase_orders i WHERE i.customer_po_id=NEW.customer_po_id AND NOT EXISTS(SELECT 1 FROM approved_configuration_batch_sites m WHERE m.batch_id=batch AND m.record_id::text=i.snapshot->>'workflowRecordId')) THEN RAISE EXCEPTION 'duplicate key: Customer PO already has an IPO outside this approved batch' USING ERRCODE='23505';END IF;
 END IF;
 RETURN NEW;
END $$;
