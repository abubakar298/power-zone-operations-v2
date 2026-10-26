-- Procurement (Moaz, 20 Oct 2026): the buyer (Hamza) sees POs received, upcoming POs and stock against
-- every coming site; raises purchase requests with vendor quotations; the head of department (Abu Bakar,
-- the only approver) approves; the buyer places the order; the material is received into stock.

-- Named-person capabilities, like restricted_cost_access: who buys and who approves.
CREATE TABLE procurement_access (
 user_id uuid NOT NULL REFERENCES users(id),
 capability text NOT NULL CHECK (capability IN ('buyer','approver')),
 granted_reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, capability)
);
-- The buyer is the Operations account the owner already routes to Procurement ("Hamza Mir").
INSERT INTO procurement_access(user_id, capability, granted_reason)
SELECT id, 'buyer', 'Procurement workspace (Moaz, 20 Oct 2026)' FROM users
WHERE active AND role = 'Operations' AND regexp_replace(lower(display_name), '[^a-z]', '', 'g') = 'hamzamir';
-- Abu Bakar is the only approver, found the same way as in 059 (restricted cost access).
INSERT INTO procurement_access(user_id, capability, granted_reason)
SELECT id, 'approver', 'Head of department approves purchases; Abu Bakar only (Moaz, 20 Oct 2026)' FROM users
WHERE active AND role IN ('Admin','Management') AND regexp_replace(lower(display_name), '[^a-z]', '', 'g') IN ('abubakar','abubakarsiddique');

-- Stock on hand, append-only: a count sets the level, receipts add to it.
CREATE TABLE stock_on_hand_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 item_key text NOT NULL REFERENCES item_master(key),
 kind text NOT NULL CHECK (kind IN ('count','receipt')),
 quantity numeric(20,6) NOT NULL CHECK (quantity >= 0),
 unit text NOT NULL,
 request_id uuid,
 note text NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_on_hand_entries_item ON stock_on_hand_entries(item_key, created_at);
CREATE TRIGGER immutable_stock_on_hand_entries BEFORE UPDATE OR DELETE ON stock_on_hand_entries
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

CREATE SEQUENCE purchase_request_number;
CREATE TABLE purchase_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 number text NOT NULL UNIQUE,
 title text NOT NULL CHECK (length(btrim(title)) > 0),
 purpose text NOT NULL DEFAULT '',
 needed_by date,
 delivery_to text NOT NULL DEFAULT 'Power Zone Store',
 payment_terms text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','rejected','ordered','received','cancelled')),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 submitted_at timestamptz,
 decided_by uuid REFERENCES users(id),
 decided_at timestamptz,
 decision_note text NOT NULL DEFAULT '',
 ordered_by uuid REFERENCES users(id),
 ordered_at timestamptz,
 order_reference text NOT NULL DEFAULT '',
 received_by uuid REFERENCES users(id),
 received_at timestamptz
);
CREATE INDEX purchase_requests_status ON purchase_requests(status, updated_at);

CREATE TABLE purchase_request_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES purchase_requests(id),
 item_key text NOT NULL REFERENCES item_master(key),
 quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
 unit text NOT NULL,
 note text NOT NULL DEFAULT '',
 chosen_quote_id uuid,
 -- Frozen when the request is sent for approval, so the approver sees what the buyer saw.
 last_rate numeric(18,4),
 last_rate_unit text NOT NULL DEFAULT '',
 last_rate_source text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (request_id, item_key)
);
CREATE TABLE purchase_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 line_id uuid NOT NULL REFERENCES purchase_request_lines(id) ON DELETE CASCADE,
 vendor text NOT NULL CHECK (length(btrim(vendor)) > 0),
 rate numeric(18,4) NOT NULL CHECK (rate >= 0),
 note text NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_quotes_line ON purchase_quotes(line_id);
ALTER TABLE purchase_request_lines ADD CONSTRAINT purchase_request_lines_chosen_quote
 FOREIGN KEY (chosen_quote_id) REFERENCES purchase_quotes(id) ON DELETE SET NULL;

-- Lines and quotations change only while the request is a draft.
CREATE OR REPLACE FUNCTION purchase_request_draft_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid uuid; st text;
BEGIN
 IF TG_TABLE_NAME = 'purchase_request_lines' THEN
  rid := COALESCE(NEW.request_id, OLD.request_id);
 ELSE
  SELECT request_id INTO rid FROM purchase_request_lines WHERE id = COALESCE(NEW.line_id, OLD.line_id);
  IF rid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF; -- the line itself is being removed in a draft
 END IF;
 SELECT status INTO st FROM purchase_requests WHERE id = rid;
 IF st IS DISTINCT FROM 'draft' THEN
  RAISE EXCEPTION 'Purchase request lines and quotations can only change while the request is a draft';
 END IF;
 RETURN COALESCE(NEW, OLD);
END; $$;
CREATE TRIGGER draft_only_purchase_request_lines BEFORE INSERT OR UPDATE OR DELETE ON purchase_request_lines
 FOR EACH ROW EXECUTE FUNCTION purchase_request_draft_only();
CREATE TRIGGER draft_only_purchase_quotes BEFORE INSERT OR UPDATE OR DELETE ON purchase_quotes
 FOR EACH ROW EXECUTE FUNCTION purchase_request_draft_only();

CREATE TABLE purchase_request_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES purchase_requests(id),
 kind text NOT NULL,
 from_status text,
 to_status text,
 note text NOT NULL DEFAULT '',
 changes jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_request_events_request ON purchase_request_events(request_id, created_at);
CREATE TRIGGER immutable_purchase_request_events BEFORE UPDATE OR DELETE ON purchase_request_events
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
