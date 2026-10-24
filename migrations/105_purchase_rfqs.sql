-- Requests for quotation (Moaz, 24 Oct 2026): Hamza sends the same requirement to several vendors at once, tender
-- style. The items and terms are frozen when the RFQ is made, so every vendor gets the same document.
CREATE SEQUENCE purchase_rfq_number;
CREATE TABLE purchase_rfqs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 number text NOT NULL UNIQUE,
 request_id uuid NOT NULL REFERENCES purchase_requests(id),
 due_on date NOT NULL,
 terms jsonb NOT NULL,
 items jsonb NOT NULL,
 contact jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_rfqs_request ON purchase_rfqs(request_id, created_at);
CREATE TRIGGER immutable_purchase_rfqs BEFORE UPDATE OR DELETE ON purchase_rfqs
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TABLE purchase_rfq_vendors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 rfq_id uuid NOT NULL REFERENCES purchase_rfqs(id),
 vendor text NOT NULL CHECK (length(btrim(vendor)) BETWEEN 1 AND 200),
 contact text NOT NULL DEFAULT '',
 replied_at timestamptz
);
CREATE UNIQUE INDEX purchase_rfq_vendors_name ON purchase_rfq_vendors(rfq_id, lower(btrim(vendor)));
-- The lowest quotation is chosen unless the buyer picks another; remember when he did.
ALTER TABLE purchase_request_lines ADD COLUMN chosen_by_buyer boolean NOT NULL DEFAULT false;
