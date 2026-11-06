-- Shared intake groups preserve one configuration snapshot per site and one PO header.
CREATE TABLE approved_configuration_batches(
 id uuid PRIMARY KEY,customer_id integer NOT NULL REFERENCES customers(id),route text NOT NULL CHECK(route IN('survey-framework','direct-framework')),
 request_key uuid NOT NULL UNIQUE,input_fingerprint text NOT NULL,snapshot jsonb NOT NULL,evidence_id uuid REFERENCES project_workflow_files(id),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE approved_configuration_batch_sites(batch_id uuid NOT NULL REFERENCES approved_configuration_batches(id),record_id uuid NOT NULL UNIQUE REFERENCES project_workflow_records(id),position integer NOT NULL CHECK(position>0),PRIMARY KEY(batch_id,position));
CREATE TABLE approved_configuration_batch_pos(batch_id uuid PRIMARY KEY REFERENCES approved_configuration_batches(id),customer_po_id uuid NOT NULL UNIQUE REFERENCES customer_purchase_orders(id));
CREATE TABLE approved_configuration_batch_confirmations(batch_id uuid PRIMARY KEY REFERENCES approved_configuration_batches(id),request_key uuid NOT NULL UNIQUE,input_fingerprint text NOT NULL,snapshot jsonb NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['approved_configuration_batches','approved_configuration_batch_sites','approved_configuration_batch_pos','approved_configuration_batch_confirmations'] LOOP EXECUTE format('CREATE TRIGGER immutable_%I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation()',t,t);END LOOP; END $$;
-- A real batch PO can cover multiple site IPOs. Existing individual orders retain
-- the old one-IPO rule via a guard, rather than duplicating the customer PO header.
ALTER TABLE internal_purchase_orders DROP CONSTRAINT internal_purchase_orders_customer_po_id_key;
CREATE INDEX internal_purchase_orders_customer_po ON internal_purchase_orders(customer_po_id);
CREATE FUNCTION protect_shared_configuration_po() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch uuid;
BEGIN
 PERFORM 1 FROM customer_purchase_orders WHERE id=NEW.customer_po_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM internal_purchase_orders WHERE customer_po_id=NEW.customer_po_id AND snapshot->>'workflowRecordId'=NEW.snapshot->>'workflowRecordId') THEN RAISE EXCEPTION 'duplicate key: This site already has an IPO under the customer PO' USING ERRCODE='23505';END IF;
 IF EXISTS(SELECT 1 FROM internal_purchase_orders WHERE customer_po_id=NEW.customer_po_id) THEN
 SELECT s.batch_id INTO batch FROM approved_configuration_batch_sites s JOIN approved_configuration_batch_pos p ON p.batch_id=s.batch_id WHERE s.record_id::text=NEW.snapshot->>'workflowRecordId' AND p.customer_po_id=NEW.customer_po_id;
 IF batch IS NULL OR EXISTS(SELECT 1 FROM internal_purchase_orders i WHERE i.customer_po_id=NEW.customer_po_id AND NOT EXISTS(SELECT 1 FROM approved_configuration_batch_sites m WHERE m.batch_id=batch AND m.record_id::text=i.snapshot->>'workflowRecordId')) THEN RAISE EXCEPTION 'duplicate key: Customer PO already has an IPO outside this approved batch' USING ERRCODE='23505';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protected_customer_po_ipo BEFORE INSERT ON internal_purchase_orders FOR EACH ROW EXECUTE FUNCTION protect_shared_configuration_po();
